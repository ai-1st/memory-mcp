# Chapter 6: Asynchronous Ingestion Pipeline

In the previous chapter, [Single-Table Data Access](05_single_table_data_access_.md), we built a robust filing cabinet (DynamoDB) to store our data.

However, right now, our system has a major limitation: **It's manual.** To get data in, we have to upload files one by one. If we want to import 5,000 tickets from Jira, we can't just make the user wait while the browser freezes for an hour.

In this chapter, we will build the **Asynchronous Ingestion Pipeline**.

## The Problem: The "Spinning Wheel"

Imagine you go to a coffee shop.
*   **Synchronous (Bad):** You order a latte. The cashier stops talking to everyone, walks to the machine, steams the milk, pours the shot, hands it to you, and *only then* takes the next customer's order. The line goes out the door.
*   **Asynchronous (Good):** You order a latte. The cashier hands you a **Ticket Number** and takes the next order immediately. A barista (a background worker) makes the coffee. When it's done, they call your number.

**The Solution:** We need a system where the user clicks "Import," gets a "Job ID," and the server does the heavy lifting in the background.

### The Use Case

We will solve this specific scenario:
> 1. A user asks to "Import Project X from Jira."
> 2. The system immediately replies: "Okay, started Job #123."
> 3. In the background, a worker scrapes 500 tickets.
> 4. Another worker processes them with AI and saves them to the database.

---

## Concept 1: The Scraper (The Gatherer)

First, we need code that can go out to the internet (Jira or Confluence) and fetch data. We use a programming concept called **Generators**.

Think of a Generator as a water tap. Instead of dumping a bucket of 5,000 items on us at once (crashing the server), it gives us one item at a time.

```javascript
// src/lib/scraper.js (Simplified)
export async function* scrapeJira({ baseUrl, jql }) {
  // 1. Fetch a page of tickets from Jira API
  const tickets = await getJiraTickets(baseUrl, jql);

  // 2. "Yield" them one by one
  for (const ticket of tickets) {
    yield {
      url: ticket.url,
      title: ticket.key + ": " + ticket.summary,
      contents: ticket.description
    };
  }
  // The loop continues to the next page automatically...
}
```
*Explanation:* The `async function*` and `yield` keywords allow this function to pause and resume, handling massive datasets without running out of memory.

---

## Concept 2: The Queue (The Conveyor Belt)

Once we scrape a ticket, we don't process it immediately. AI processing takes time (seconds per document). If we scrape fast but process slow, we create a bottleneck.

We use **AWS SQS (Simple Queue Service)** as a buffer.
1.  **Scraper Worker:** Puts raw documents onto the conveyor belt (Queue).
2.  **Process Worker:** Takes one item off the belt, runs the AI, and saves it.

This ensures that if the AI is slow, the scraper doesn't have to stop working.

---

## Concept 3: Job Tracking (The Status Board)

Since the user isn't watching a loading bar, we need to save the status in our database so they can check it later.

We use our DynamoDB setup from Chapter 5.

```javascript
// src/lib/queue.js
export async function putScrapeJob(projectId, job) {
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `P#${projectId}#SCRAPE`, // Group by Project
      SK: `JOB#${job.id}`,         // Unique Job ID
      status: 'pending',           // pending, scraping, completed
      docsFound: 0,
    },
  }));
}
```
*Explanation:* This creates a record like "Job 123 is currently Pending." We update this record as the workers finish their tasks.

---

## Under the Hood: The Relay Race

Let's visualize the flow of data through our factory.

```mermaid
sequenceDiagram
    participant User
    participant API as Admin API
    participant SW as Scrape Worker (Lambda)
    participant SQS as SQS Queue
    participant PW as Process Worker (Lambda)
    participant DB as DynamoDB

    User->>API: "Start Import"
    API->>DB: Create Job "Pending"
    API->>SW: Trigger Scraper (Async)
    API-->>User: Return "Job ID: 123"
    
    Note over User, API: User is free to go!
    
    SW->>SW: Scrape Jira... Found Ticket A
    SW->>SQS: Send Ticket A to Queue
    SW->>DB: Update Job "In Progress"
    
    SQS->>PW: Trigger Processor
    PW->>PW: Run AI extraction
    PW->>DB: Save Topic & Update Status
```

---

## Implementation Step 1: The Scrape Worker

This worker is the "Foreman." It starts the job, fetches the raw data, and places orders on the queue.

It lives in `src/workers/scrapeWorker.js`.

```javascript
// src/workers/scrapeWorker.js
import { scrapeJira } from '../lib/scraper.js';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

export const handler = async (event) => {
  // 1. Read instructions from the trigger event
  const { projectId, jobId, config } = JSON.parse(event.Records[0].body);

  // 2. Start the generator
  const scraper = scrapeJira(config);

  for await (const doc of scraper) {
    // 3. Save raw doc to DB (Safety backup)
    const docId = await saveRawDocToDB(projectId, doc);

    // 4. Send a message to the Queue: "Hey, process this Doc ID!"
    await sqs.send(new SendMessageCommand({
      QueueUrl: process.env.PROCESS_QUEUE_URL,
      MessageBody: JSON.stringify({ projectId, docId })
    }));
  }
};
```
*Explanation:*
1.  It wakes up when we tell it to start a job.
2.  It loops through every ticket found in Jira.
3.  It **does not** run the AI. It just puts a message in SQS saying "Ready for processing." This keeps the scraper fast.

---

## Implementation Step 2: The Process Worker

This worker is the "Specialist." It sits at the end of the conveyor belt. It wakes up only when SQS gives it a message.

It lives in `src/workers/processWorker.js`.

```javascript
// src/workers/processWorker.js
import { processDocument } from '../lib/processor.js';
import { getDoc } from '../lib/db.js';

export const handler = async (event) => {
  // 1. Loop through messages from SQS
  for (const record of event.Records) {
    const { projectId, docId } = JSON.parse(record.body);

    // 2. Fetch the raw content we saved earlier
    const doc = await getDoc(projectId, docId);

    // 3. Run the AI Brain (From Chapter 3)
    await processDocument(projectId, {
      url: doc.url,
      contents: doc.contents
    });
    
    console.log(`Finished processing ${doc.title}`);
  }
};
```
*Explanation:*
1.  This function is triggered automatically by AWS whenever the queue has items.
2.  It reuses the logic we wrote in [AI Knowledge Processor](03_ai_knowledge_processor_.md).
3.  Because this runs on many parallel Lambda functions, we can process 100 tickets at the same time!

---

## Handling Updates

In `src/lib/queue.js`, we have helper functions to keep the scoreboard updated.

```javascript
// src/lib/queue.js
export async function updateScrapeJob(projectId, jobId, updates) {
  // Update DynamoDB with new counts
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `P#${projectId}#SCRAPE`, SK: `JOB#${jobId}` },
    UpdateExpression: `SET status = :s, docsFound = :d`,
    ExpressionAttributeValues: {
      ':s': updates.status,
      ':d': updates.docsFound
    },
  }));
}
```
*Explanation:* The workers call this periodically. Even though the user isn't watching, the database knows exactly how many documents have been finished.

---

## Summary

In this chapter, we turned our single-player application into a factory.

1.  **Generators:** We used `yield` to handle large streams of data from Jira/Confluence.
2.  **Queues:** We used SQS to decouple "finding work" (scraping) from "doing work" (processing).
3.  **Workers:** We built background functions that run automatically to handle the load.

Now our system is powerful, smart, and scalable. But currently, the only way to trigger these jobs is by manually invoking code. We need a control panel.

In the final chapter, we will build the **Admin REST API** to let the outside world (and our frontend) control this machinery.

[Next Chapter: Admin REST API](07_admin_rest_api_.md)

---

Generated by [AI Codebase Knowledge Builder](https://github.com/The-Pocket/Tutorial-Codebase-Knowledge)
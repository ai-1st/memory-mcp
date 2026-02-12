# Anthropic MCP Server Template for AWS Lambda

This repository provides a template for developing Stateless Streamable HTTP MCP servers using AWS Lambda NodeJS

We will implement a subset of the Model Context Protocol (MCP) features, focusing on the stateless HTTP request/response model. The SSE (Server-Sent Events) and stdio parts of the protocol are intentionally omitted to ensure compatibility with serverless runtimes.

Note: We’ll also add non-standard protocol extensions (details below).

## WebTools Extensions for MCP

This implementation extends the MCP protocol to:

* Let clients send config data to tools separately from the LLM payload. Useful for passing tokens or temporary creds without exposing them to the LLM.
* Let tools return extra outputs like charts, raw data, or logs that skip the LLM and go straight to the environment. Main use case: attach detailed charts without stuffing the LLM context with tons of data points.
* Let users pin a specific version of a tool. This helps avoid security issues where newer schema versions might sneak in malicious instructions through updated webtool metadata.

We only extend the protocol for the `tools/list` and `tools/call` requests.

## tools/list

**Description:** The client sends `tools/list` to get the list of tools (functions/actions) the server provides. The response includes an array of tool definitions. Each tool has a `name`, a `description` of its functionality, and an `inputSchema` (a JSON Schema object) describing the expected parameters for that tool. The example below shows one tool with a required `location` parameter.

We’re adding a `version` parameter so the client can request a specific version of the tool metadata. The `version` can be a SHA-256 hash of the `json-stable-stringify` output of the tools object in the response JSON.

We’re also adding a `configSchema` attribute to the response. This lets the server tell the client which extra config params it can send. `configSchema` is for the user, not the LLM. The server can include default values to make it easier for the user to fill out.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {
    "version": "optional version-id"
  }
}
```



**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "version": "optional version-id",
    "tools": [
      {
        "name": "get_weather",
        "description": "Get current weather information for a location",
        "inputSchema": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string",
              "description": "City name or zip code"
            }
          },
          "required": ["location"]
        },
        "configSchema": {
          "type": "object",
          "properties": {
            "apiKey": "string",
            "description": "A temporary API key for the weather service"
          }
        }
      }
    ]
  }
}
```

## tools/call

**Description:** To execute a specific tool, the client sends a `tools/call` request with the tool's `name` and an `arguments` object providing the needed inputs. The server will run the tool and return a result. The result includes a `content` array (which may contain text or other content types, depending on what the tool returns) and an `isError` boolean indicating whether the tool succeeded. In this example, the tool returns a text result (weather information) and `isError: false` to show success.

We've added to the request `version` to let the server know which version of the metainformation we are using, and `config` to provide some extra information.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "version": "optional version-id",
    "config": {
      "apiKey": "optional config values"
    }
    "arguments": {
      "location": "New York"
    }
  }
}
```

In the response, the server may return an `extra` attribute with some parameters that are to be hadnled by the environment rather than by the LLM.

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Current weather in New York:\n Temperature: 72°F\n Conditions: Partly cloudy"
      }
    ],
    "isError": false,
    "extra": {
      "vegaLiteChart": "vega-lite chart spec",
      "rawDataPoints": []
    }
  }
}
```


# Examples of other JSON-RPC Messages as defined in Anthropic MCP spec (Stateless HTTP Mode)

Below are example JSON-RPC 2.0 request and response objects for each relevant Model Context Protocol (MCP) command in stateless HTTP mode. Each example shows a complete JSON structure with realistic field values, based on the MCP specification. (All streaming or SSE-based fields are omitted, as these examples assume a non-streaming HTTP interaction.)

## initialize

**Description:** The client begins a session by sending an `initialize` request with its supported protocol version, capabilities, and client info. The server replies with its own protocol version (which may be negotiated), supported server capabilities (e.g. logging, prompts, resources, tools), server info, and any optional instructions.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {
      "roots": {
        "listChanged": true
      },
      "sampling": {}
    },
    "clientInfo": {
      "name": "ExampleClient",
      "version": "1.0.0"
    }
  }
}
```



**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-03-26",
    "capabilities": {
      "logging": {},
      "prompts": {
        "listChanged": true
      },
      "resources": {
        "subscribe": true,
        "listChanged": true
      },
      "tools": {
        "listChanged": true
      }
    },
    "serverInfo": {
      "name": "ExampleServer",
      "version": "1.0.0"
    },
    "instructions": "Optional instructions for the client"
  }
}
```



## initialized (notification)

**Description:** After the server responds to `initialize`, the client sends an `initialized` notification to signal that it is ready for normal operations. This is a JSON-RPC notification (no `id` field and no response expected).

**Notification:**

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```



## ping

**Description:** Either party can send a `ping` request at any time to check connectivity. The `ping` request has no parameters, and the receiver must promptly return an empty result object if still alive.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": "123",
  "method": "ping"
}
```



**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": "123",
  "result": {}
}
```



## resources/list

**Description:** The client requests a list of available resources (files, data, etc.) from the server. The `resources/list` request may include an optional `cursor` for pagination. The response contains an array of resource descriptors (each with fields like `uri`, `name`, `description`, `mimeType`, etc.) and may include a `nextCursor` token if more results are available.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "resources/list",
  "params": {
    "cursor": "optional-cursor-value"
  }
}
```



**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "resources": [
      {
        "uri": "file:///project/src/main.rs",
        "name": "main.rs",
        "description": "Primary application entry point",
        "mimeType": "text/x-rust"
      }
    ],
    "nextCursor": "next-page-cursor"
  }
}
```



## resources/read

**Description:** The client retrieves the contents of a specific resource by sending `resources/read` with the resource's URI. The server's response includes a `contents` array with the resource data. If the resource is text-based, it appears under a `text` field (with an associated MIME type); for binary data, a `blob` (base64 string) would be used instead.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/read",
  "params": {
    "uri": "file:///project/src/main.rs"
  }
}
```



**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "contents": [
      {
        "uri": "file:///project/src/main.rs",
        "mimeType": "text/x-rust",
        "text": "fn main() {\n    println!(\"Hello world!\");\n}"
      }
    ]
  }
}
```



## resources/templates/list

**Description:** The client can query available *resource templates* (parameterized resource URIs) by sending `resources/templates/list`. The response provides a list of resource template definitions, each with a `uriTemplate` (often containing placeholders), a human-readable `name` and `description`, and an optional `mimeType` indicating the type of resource produced.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "resources/templates/list"
}
```



**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "resourceTemplates": [
      {
        "uriTemplate": "file:///{path}",
        "name": "Project Files",
        "description": "Access files in the project directory",
        "mimeType": "application/octet-stream"
      }
    ]
  }
}
```



## prompts/list

**Description:** The client requests a list of available prompt templates by sending `prompts/list`. This may also support pagination via a `cursor`. The server responds with an array of prompt definitions, where each prompt has a unique `name`, a `description` of what it does, and an optional list of expected `arguments` (each argument with a name, description, and whether it's required). A `nextCursor` may be provided if the list is paginated.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "prompts/list",
  "params": {
    "cursor": "optional-cursor-value"
  }
}
```



**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "prompts": [
      {
        "name": "code_review",
        "description": "Asks the LLM to analyze code quality and suggest improvements",
        "arguments": [
          {
            "name": "code",
            "description": "The code to review",
            "required": true
          }
        ]
      }
    ],
    "nextCursor": "next-page-cursor"
  }
}
```



## prompts/get

**Description:** To fetch the content of a specific prompt template (possibly filling in arguments), the client sends `prompts/get` with the prompt's `name` and an `arguments` object providing any required values. The server returns the resolved prompt: typically a `description` and a sequence of `messages` that make up the prompt. Each message has a `role` (e.g. "user" or "assistant") and `content` which could be text or other supported content types.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "prompts/get",
  "params": {
    "name": "code_review",
    "arguments": {
      "code": "def hello():\n    print('world')"
    }
  }
}
```



**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "description": "Code review prompt",
    "messages": [
      {
        "role": "user",
        "content": {
          "type": "text",
          "text": "Please review this Python code:\n def hello():\n    print('world')"
        }
      }
    ]
  }
}
```






Each JSON example above illustrates the structure and fields defined by the MCP specification for stateless HTTP usage, covering the full request/response cycle (or one-way notification) for that command. These messages can be sent over an HTTP-based JSON-RPC connection to manage the model's context and actions without using server-sent events or streaming protocols. All field names and nesting conform to the MCP spec, ensuring interoperability between MCP clients and servers.

## Deployment

This template uses AWS SAM (Serverless Application Model) for deployment. The Lambda function is configured with:
- **Runtime**: Node.js 22
- **Architecture**: ARM64 (Graviton)
- **Region**: us-east-1
- **Endpoint**: Lambda Function URL (public HTTP endpoint)

### Prerequisites

1. **AWS SAM CLI**: Install the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
2. **Node.js 22**: Ensure Node.js 22 is installed
3. **AWS Credentials**: Set up AWS credentials using the `creds` alias

### Setting Up AWS Credentials

Before deploying, set up your AWS credentials using the `creds` alias:

```bash
creds
```

This will configure your AWS credentials as environment variables needed for deployment.

### Building and Deploying

1. **Build the application**:
   ```bash
   sam build
   ```

2. **Deploy to AWS**:
   ```bash
   sam deploy --region us-east-1
   ```

   On first deployment, SAM will prompt you to create a deployment configuration file (`samconfig.toml`). You can accept the defaults or customize as needed.

3. **Get the Function URL**:
   After deployment, SAM will output the Lambda Function URL. You can also retrieve it from the CloudFormation stack outputs:
   ```bash
   aws cloudformation describe-stacks --stack-name aws-lambda-nodejs-mcp --region us-east-1 --query 'Stacks[0].Outputs[?OutputKey==`McpServerFunctionUrl`].OutputValue' --output text
   ```

### Testing the Deployment

Once deployed, you can test the MCP server by sending JSON-RPC requests to the Function URL:

```bash
curl -X POST https://<your-function-url> \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "ping"
  }'
```

### Project Structure

```
aws-lambda-nodejs-mcp/
├── template.yaml          # AWS SAM template
├── package.json           # Node.js dependencies
├── src/
│   ├── index.js          # Lambda handler entry point
│   ├── mcp/
│   │   ├── router.js     # JSON-RPC method router
│   │   ├── handlers/     # MCP protocol handlers
│   │   └── utils.js      # JSON-RPC utilities
│   └── tools/            # Tool implementations
└── README.md
```

### Adding Custom Tools

To add custom tools, create a new file in `src/tools/` following the pattern in `src/tools/getWeather.js`, then register it in `src/tools/index.js`.


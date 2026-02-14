import TopicCard from './TopicCard';

export default function TopicList({ topics, showScore = false }) {
  if (!topics || topics.length === 0) {
    return <div className="empty-state"><p>No topics found.</p></div>;
  }

  return (
    <div className="topic-list">
      {topics.map(t => (
        <TopicCard key={t.id} topic={t} showScore={showScore} />
      ))}
    </div>
  );
}

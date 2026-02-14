import { Link } from 'react-router-dom';
import Markdown from './Markdown';

export default function TopicCard({ topic, showScore = false }) {
  return (
    <div className="topic-card">
      <div className="topic-header">
        <Link
          className="topic-category"
          to={`/topics/${encodeURIComponent(topic.category)}`}
        >
          {topic.category}
        </Link>
        {showScore && topic.score != null && (
          <span className="topic-score">{Math.round(topic.score * 100)}%</span>
        )}
      </div>
      {topic.title && <div className="topic-title">{topic.title}</div>}
      <div className="topic-summary">
        <Markdown>{topic.summary}</Markdown>
      </div>
      <div className="topic-meta">
        <span className="topic-id">{topic.id}</span>
        {(topic.doc_ids || []).map(did => (
          <Link key={did} className="doc-link" to={`/document/${did}`}>
            doc:{did.slice(0, 8)}...
          </Link>
        ))}
      </div>
    </div>
  );
}

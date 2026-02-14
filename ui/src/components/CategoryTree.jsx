import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

function buildTree(categories) {
  const root = { children: {}, count: 0 };
  for (const { category, topicCount } of categories) {
    const parts = category.split('/');
    let node = root;
    for (const part of parts) {
      if (!node.children[part]) {
        node.children[part] = { children: {}, count: 0, fullPath: '' };
      }
      node = node.children[part];
      node.count += topicCount;
    }
    node.fullPath = category;
    node.leafCount = topicCount;
  }
  return root;
}

function TreeNode({ name, node, depth }) {
  const [open, setOpen] = useState(true);
  const navigate = useNavigate();
  const hasChildren = Object.keys(node.children).length > 0;
  const isLeaf = node.fullPath && node.leafCount != null;

  const entries = Object.entries(node.children).sort((a, b) => b[1].count - a[1].count);

  function handleClick() {
    if (isLeaf) {
      navigate(`/topics/${encodeURIComponent(node.fullPath)}`);
    }
  }

  return (
    <div className="tree-node" style={{ paddingLeft: depth > 0 ? 20 : 0 }}>
      <div
        className={`tree-row${isLeaf ? ' tree-leaf' : ''}`}
        onClick={handleClick}
      >
        {hasChildren ? (
          <span
            className={`tree-toggle${open ? ' open' : ''}`}
            onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
          >
            &#9662;
          </span>
        ) : (
          <span className="tree-toggle-spacer" />
        )}
        <span className="tree-label">{name}</span>
        <span className="tree-count">{node.count}</span>
      </div>
      {hasChildren && open && (
        <div className="tree-children">
          {entries.map(([childName, childNode]) => (
            <TreeNode key={childName} name={childName} node={childNode} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CategoryTree({ categories }) {
  const tree = buildTree(categories);
  const entries = Object.entries(tree.children).sort((a, b) => b[1].count - a[1].count);

  return (
    <div className="category-tree">
      {entries.map(([name, node]) => (
        <TreeNode key={name} name={name} node={node} depth={0} />
      ))}
    </div>
  );
}

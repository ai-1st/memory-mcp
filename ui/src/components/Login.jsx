import { useState } from 'react';
import { setAuthCredentials, api } from '../lib/api';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      setAuthCredentials(username, password);
      await api.listProjects();
      onLogin();
    } catch {
      setError('Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-backdrop">
      <form className="login-form" onSubmit={handleSubmit}>
        <div className="login-header">
          <span className="logo-icon">&#9673;</span>
          <span className="logo-text">Memory</span>
        </div>
        <label className="login-label">Username</label>
        <input
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoComplete="username"
        />
        <label className="login-label">Password</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus
        />
        {error && <p className="login-error">{error}</p>}
        <button className="btn-primary" type="submit" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Loading from './Loading';
import Toast from './Toast';
import { useApp } from '../lib/store';

export default function Layout() {
  const { loading } = useApp();

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <Outlet />
        {loading && <Loading />}
      </main>
      <Toast />
    </div>
  );
}

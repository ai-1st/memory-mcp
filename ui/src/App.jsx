import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Search from './pages/Search';
import Documents from './pages/Documents';
import Document from './pages/Document';
import AddDocument from './pages/AddDocument';
import Chunks from './pages/Chunks';
import Projects from './pages/Projects';
import ScrapeQueue from './pages/ScrapeQueue';
import ProcessQueue from './pages/ProcessQueue';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/search" replace />} />
        <Route path="search" element={<Search />} />
        <Route path="documents" element={<Documents />} />
        <Route path="document/:docId" element={<Document />} />
        <Route path="chunks" element={<Chunks />} />
        <Route path="add" element={<AddDocument />} />
        <Route path="projects" element={<Projects />} />
        <Route path="scrape" element={<ScrapeQueue />} />
        <Route path="process" element={<ProcessQueue />} />
      </Route>
    </Routes>
  );
}

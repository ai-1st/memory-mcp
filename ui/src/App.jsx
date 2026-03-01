import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Categories from './pages/Categories';
import Topics from './pages/Topics';
import Search from './pages/Search';
import AddDocument from './pages/AddDocument';
import Document from './pages/Document';
import Projects from './pages/Projects';
import Queues from './pages/Queues';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/categories" replace />} />
        <Route path="categories" element={<Categories />} />
        <Route path="topics/:category" element={<Topics />} />
        <Route path="search" element={<Search />} />
        <Route path="add" element={<AddDocument />} />
        <Route path="document/:docId" element={<Document />} />
        <Route path="projects" element={<Projects />} />
        <Route path="queues" element={<Queues />} />
      </Route>
    </Routes>
  );
}

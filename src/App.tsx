import { Route, Routes } from 'react-router-dom';
import { HostPage } from './ui/HostPage';
import { JoinPage } from './ui/JoinPage';
import { Lobby } from './ui/Lobby';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Lobby />} />
      <Route path="/host/:gameId" element={<HostPage />} />
      <Route path="/join/:gameId" element={<JoinPage />} />
      <Route path="*" element={<Lobby />} />
    </Routes>
  );
}

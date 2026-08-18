import { Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';
import { HomePage } from './routes/HomePage';
import { EncodePage } from './routes/EncodePage';
import { DecodePage } from './routes/DecodePage';
import { NotFoundPage } from './routes/NotFoundPage';

export function App() {
  return (
    <ErrorBoundary>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/encode" element={<EncodePage />} />
        <Route path="/decode" element={<DecodePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ErrorBoundary>
  );
}

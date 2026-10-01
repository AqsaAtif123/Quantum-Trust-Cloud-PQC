import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Collaboration from './pages/Collaboration';
import Files from './pages/Files';
import Shared from './pages/Shared';
import Vault from './pages/Vault';
import TrustCompliance from './pages/TrustCompliance';
import AuditLog from './pages/AuditLog';
import QuantumPay from './pages/QuantumPay';
import SecurityCenter from './pages/SecurityCenter';
import Notifications from './pages/Notifications';
import Settings from './pages/Settings';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/files" element={<Files />} />
        <Route path="/shared" element={<Shared />} />
        <Route path="/collaboration" element={<Collaboration />} />
        <Route path="/vault" element={<Vault />} />
        <Route path="/trust" element={<TrustCompliance />} />
        <Route path="/pay" element={<QuantumPay />} />
        <Route path="/guard" element={<Navigate to="/security" replace />} />
        <Route path="/security" element={<SecurityCenter />} />
        <Route path="/audit" element={<AuditLog />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

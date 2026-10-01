import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

/**
 * NOTE: this only controls client-side navigation/UX. It is not a security
 * boundary — the backend's zero-trust middleware (requireAuth) is what
 * actually enforces access, exactly per the "never trust the frontend"
 * requirement. A user with a stale/no token can still never reach real data,
 * regardless of what this component does.
 */
export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

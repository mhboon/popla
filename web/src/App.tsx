import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/AuthContext';
import { useAuth } from './lib/useAuth';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { ParticipantsPage } from './pages/ParticipantsPage';
import { MatchdaySetupPage } from './pages/MatchdaySetupPage';
import { MatchdayPage } from './pages/MatchdayPage';

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? '/participants' : '/login'} replace />;
}

export function App() {
  return (
    <AuthProvider>
      <Layout>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<HomeRedirect />} />
          <Route
            path="/participants"
            element={
              <ProtectedRoute>
                <ParticipantsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/matchdays/new"
            element={
              <ProtectedRoute>
                <MatchdaySetupPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/matchdays/:matchdayId"
            element={
              <ProtectedRoute>
                <MatchdayPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </Layout>
    </AuthProvider>
  );
}

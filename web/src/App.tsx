import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/AuthContext';
import { useAuth } from './lib/useAuth';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { ParticipantsPage } from './pages/ParticipantsPage';
import { SeasonsPage } from './pages/SeasonsPage';
import { SeasonRankingPage } from './pages/SeasonRankingPage';
import { MatchdaysPage } from './pages/MatchdaysPage';
import { MatchdaySetupPage } from './pages/MatchdaySetupPage';
import { RegistrationSetupPage } from './pages/RegistrationSetupPage';
import { MatchdayPage } from './pages/MatchdayPage';

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.isAdmin ? '/participants' : '/seasons'} replace />;
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
            path="/seasons"
            element={
              <ProtectedRoute requireAdmin={false}>
                <SeasonsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/seasons/:seasonId/ranking"
            element={
              <ProtectedRoute requireAdmin={false}>
                <SeasonRankingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/matchdays"
            element={
              <ProtectedRoute requireAdmin={false}>
                <MatchdaysPage />
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
            path="/matchdays/register"
            element={
              <ProtectedRoute>
                <RegistrationSetupPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/matchdays/:matchdayId/edit"
            element={
              <ProtectedRoute>
                <MatchdaySetupPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/matchdays/:matchdayId"
            element={
              <ProtectedRoute requireAdmin={false}>
                <MatchdayPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </Layout>
    </AuthProvider>
  );
}

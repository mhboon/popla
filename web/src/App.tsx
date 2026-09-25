import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/AuthContext';
import { useAuth } from './lib/useAuth';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { AccountPage } from './pages/AccountPage';
import { ParticipantsPage } from './pages/ParticipantsPage';
import { ParticipantPage } from './pages/ParticipantPage';
import { SeasonsPage } from './pages/SeasonsPage';
import { SeasonRankingPage } from './pages/SeasonRankingPage';
import { PlayerSeasonResultsPage } from './pages/PlayerSeasonResultsPage';
import { MatchdaysPage } from './pages/MatchdaysPage';
import { MatchdaySetupPage } from './pages/MatchdaySetupPage';
import { MatchdayPage } from './pages/MatchdayPage';

// "/" itself: the login page when signed out, a real home page when
// signed in — not a redirect into whichever section an admin vs.
// participant used to land on, so the logo (which links here) and a
// bookmark of "/" both behave the same regardless of role.
function RootRoute() {
  const { user, loading } = useAuth();
  if (loading) return <p>Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return <HomePage />;
}

// Bookmarking or directly opening /login while already signed in (the
// original bug report here) otherwise just shows the login form again
// despite a perfectly valid session — send it home instead.
function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return <p>Loading…</p>;
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}

export function App() {
  return (
    <AuthProvider>
      <Layout>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/" element={<RootRoute />} />
          <Route
            path="/account"
            element={
              <ProtectedRoute requireAdmin={false}>
                <AccountPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/participants"
            element={
              <ProtectedRoute>
                <ParticipantsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/participants/:playerId"
            element={
              <ProtectedRoute>
                <ParticipantPage />
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
            path="/seasons/:seasonId/players/:playerId"
            element={
              <ProtectedRoute requireAdmin={false}>
                <PlayerSeasonResultsPage />
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

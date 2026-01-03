import { Routes, Route, Navigate, Link } from 'react-router-dom'
import './App.css'
import Home from './pages/Home.jsx'
import Wiki from './pages/Wiki.jsx'
import Community from './pages/Community.jsx'
import Login from './pages/Login.jsx'
import Profile from './pages/Profile.jsx'
import NewPost from './pages/NewPost.jsx'
import Challenge from './pages/Challenge.jsx'
import DailyChallenge from './pages/DailyChallenge.jsx'
import ChallengeLeaderboard from './pages/ChallengeLeaderboard.jsx'
import AdminClaim from './pages/AdminClaim.jsx'
import PostPage from './pages/Post.jsx'
import ProblemArchive from './pages/ProblemArchive.jsx'
import Contact from './pages/Contact.jsx'
import Claims from './pages/Claims.jsx'
import Navbar from './components/Navbar.jsx'
import ArithmeticGame from './pages/ArithmeticGame.jsx'
import FunctionBallGame from './pages/FunctionBallGame.jsx'
import { PanelsProvider } from './components/panels/PanelsContext.jsx'
import RightDock from './components/panels/RightDock.jsx'
import ChatAutoOpen from './components/chat/ChatAutoOpen.jsx'
import ViewportVars from './components/layout/ViewportVars.jsx'

function App() {
  return (
    <div className="app-root">
      <PanelsProvider>
        <Navbar />
        <ViewportVars />
        <ChatAutoOpen />
        <div className="workspace">
          <div className="workspace-left" id="main">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/wiki" element={<Wiki />} />
              <Route path="/wiki/:slug" element={<Wiki />} />
              <Route path="/community" element={<Community />} />
              <Route path="/community/post/:postId" element={<PostPage />} />
              <Route path="/login" element={<Login />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/claims" element={<Claims />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/profile/:uid" element={<Profile />} />
              <Route path="/new" element={<NewPost />} />
              <Route path="/challenge" element={<Challenge />} />
              <Route path="/challenge/daily" element={<DailyChallenge />} />
              <Route path="/challenge/daily/:dateKey" element={<DailyChallenge />} />
              <Route path="/challenge/leaderboard" element={<ChallengeLeaderboard />} />
              <Route path="/challenge/arithmetic" element={<ArithmeticGame />} />
              <Route path="/challenge/function-ball" element={<FunctionBallGame />} />
              <Route path="/archive" element={<ProblemArchive />} />
              <Route path="/archive/:dateKey" element={<ProblemArchive />} />
              <Route path="/admin-claim" element={<AdminClaim />} />
              {/* Back-compat */}
              <Route path="/test" element={<Navigate to="/challenge" replace />} />
              <Route path="/test/arithmetic" element={<Navigate to="/challenge/arithmetic" replace />} />
              <Route path="/test/function-ball" element={<Navigate to="/challenge/function-ball" replace />} />
              <Route path="*" element={<div style={{padding:16}}><h2>Not Found</h2><Link to="/">Go Home</Link></div>} />
            </Routes>
          </div>
          <RightDock />
        </div>
      </PanelsProvider>
    </div>
  )
}

export default App

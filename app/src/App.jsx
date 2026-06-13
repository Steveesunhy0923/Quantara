import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, Link } from 'react-router-dom'
import './App.css'
import Navbar from './components/Navbar.jsx'
import { PanelsProvider } from './components/panels/PanelsContext.jsx'
import ViewportVars from './components/layout/ViewportVars.jsx'

const Home = lazy(()=>import('./pages/Home.jsx'))
const LatexLearning = lazy(()=>import('./pages/LatexLearning.jsx'))
const Wiki = lazy(()=>import('./pages/Wiki.jsx'))
const Community = lazy(()=>import('./pages/Community.jsx'))
const PostPage = lazy(()=>import('./pages/Post.jsx'))
const Login = lazy(()=>import('./pages/Login.jsx'))
const Contact = lazy(()=>import('./pages/Contact.jsx'))
const Claims = lazy(()=>import('./pages/Claims.jsx'))
const Profile = lazy(()=>import('./pages/Profile.jsx'))
const NewPost = lazy(()=>import('./pages/NewPost.jsx'))
const Challenge = lazy(()=>import('./pages/Challenge.jsx'))
const DailyChallenge = lazy(()=>import('./pages/DailyChallenge.jsx'))
const ChallengeLeaderboard = lazy(()=>import('./pages/ChallengeLeaderboard.jsx'))
const ArithmeticGame = lazy(()=>import('./pages/ArithmeticGame.jsx'))
const FunctionBallGame = lazy(()=>import('./pages/FunctionBallGame.jsx'))
const ProblemArchive = lazy(()=>import('./pages/ProblemArchive.jsx'))
const AdminClaim = lazy(()=>import('./pages/AdminClaim.jsx'))

const RightDock = lazy(()=>import('./components/panels/RightDock.jsx'))
const ChatAutoOpen = lazy(()=>import('./components/chat/ChatAutoOpen.jsx'))

function RouteFallback(){
  return (
    <div style={{padding:16, color:'#444'}}>
      Loading…
    </div>
  )
}

function App() {
  return (
    <div className="app-root">
      <PanelsProvider>
        <Navbar />
        <ViewportVars />
        <Suspense fallback={null}>
          <ChatAutoOpen />
        </Suspense>
        <div className="workspace">
          <div className="workspace-left" id="route-root">
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/latex-learning" element={<LatexLearning />} />
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
            </Suspense>
          </div>
          <Suspense fallback={null}>
            <RightDock />
          </Suspense>
        </div>
      </PanelsProvider>
    </div>
  )
}

export default App

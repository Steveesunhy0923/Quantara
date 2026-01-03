import { Link } from 'react-router-dom'

export default function Challenge(){
  return (
    <div style={{padding:16, width:'100%', maxWidth: 900, margin:'0 auto'}}>
      <h1>Challenge</h1>
      <p style={{color:'#666', marginTop:0}}>Daily problems + games + leaderboard.</p>

      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))', gap:12, marginTop:16}}>
        <GameCard
          title="Daily Problem"
          desc="A new challenge every day. Pick one difficulty; faster correct = higher rank score."
          to="/challenge/daily"
          cta="Play Daily"
        />
        <GameCard
          title="Leaderboard"
          desc="Separate leaderboards per difficulty (min 5 days). Rank-based average score."
          to="/challenge/leaderboard"
          cta="View Leaderboard"
        />
        <GameCard
          title="120s Arithmetic"
          desc="Answer as many arithmetic problems as you can in 2 minutes."
          to="/challenge/arithmetic"
          cta="Play Arithmetic"
        />
        <GameCard
          title="Function Ball (Physics)"
          desc="Use functions as surfaces to guide a ball from start to finish. Gravity/mass/friction change per level."
          to="/challenge/function-ball"
          cta="Play Function Ball"
        />
      </div>
    </div>
  )
}

function GameCard({ title, desc, to, cta }){
  return (
    <div style={{border:'1px solid #ddd', borderRadius:10, padding:14, background:'#fff', color:'#111'}}>
      <h3 style={{margin:'0 0 .25rem 0'}}>{title}</h3>
      <p style={{margin:'0 0 .9rem 0', color:'#555'}}>{desc}</p>
      <Link to={to} style={{display:'inline-block', padding:'.55rem .9rem', borderRadius:8, background:'#1a73e8', color:'#fff', textDecoration:'none'}}>
        {cta}
      </Link>
    </div>
  )
}



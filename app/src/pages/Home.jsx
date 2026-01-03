import { useNavigate } from 'react-router-dom'

export default function Home(){
  const navigate = useNavigate()

  return (
    <div style={{maxWidth:900, margin:'0 auto', padding:'24px 16px 80px'}}>
      <h2 style={{marginTop:0}}>Quantara</h2>
      <div style={{color:'#555', maxWidth:720}}>
        Community math problems, discussions, and challenges.
      </div>

      <div style={{display:'flex', gap:10, flexWrap:'wrap', marginTop:16}}>
        <button type="button" onClick={()=>navigate('/community')}>Go to Community</button>
        <button type="button" onClick={()=>navigate('/challenge')}>Challenges</button>
        <button type="button" onClick={()=>navigate('/contact')}>Contact us</button>
      </div>

      <div style={{marginTop:22, color:'#666', fontSize:'.95rem'}}>
        Need help, want to file a claim, or report an issue? Use <b>Contact us</b>.
      </div>
    </div>
  )
}



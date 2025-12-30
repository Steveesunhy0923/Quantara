export default function GroupAvatar({ urls = [], size = 36, borderColor = '#ddd' }){
  const pics = (Array.isArray(urls) ? urls : []).filter(Boolean).slice(0, 4)
  const grid = pics.length <= 1 ? 1 : 2
  const cell = Math.floor(size / grid)

  if (pics.length <= 1){
    return (
      <img
        src={pics[0] || 'https://via.placeholder.com/36'}
        alt=""
        style={{width:size, height:size, borderRadius:'50%', objectFit:'cover', border:`1px solid ${borderColor}`}}
      />
    )
  }

  return (
    <div
      style={{
        width:size,
        height:size,
        borderRadius:'50%',
        overflow:'hidden',
        border:`1px solid ${borderColor}`,
        display:'grid',
        gridTemplateColumns:`repeat(${grid}, ${cell}px)`,
        gridTemplateRows:`repeat(${grid}, ${cell}px)`,
        background:'#f3f4f6',
      }}
    >
      {Array.from({ length: grid * grid }).map((_, idx)=>{
        const src = pics[idx] || 'https://via.placeholder.com/36'
        return (
          <img
            key={idx}
            src={src}
            alt=""
            style={{width:cell, height:cell, objectFit:'cover', display:'block'}}
          />
        )
      })}
    </div>
  )
}



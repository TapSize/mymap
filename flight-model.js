(function(root){
 'use strict';
 const G=9.80665,rad=Math.PI/180;
 function turn(speed,bank){const v=speed/3.6,r=v*v/(G*Math.tan(bank*rad));return {r,t:Math.PI*r/(2*v),arc:Math.PI*r/2};}
 function build(config){
  if(!config||!Array.isArray(config.legs)||config.legs.length!==7||!Array.isArray(config.turns)||config.turns.length!==4)throw Error('Нужны семь участков и четыре разворота.');
  const positive=n=>Number.isFinite(n)&&n>0;
  if(!Number.isFinite(config.course)||config.course<0||config.course>360)throw Error('Проверьте посадочный курс.');
  config.legs.forEach(l=>{if(!Number.isFinite(l.s)||l.s<0||!positive(l.w))throw Error('Проверьте длины и скорости участков.');});
  config.turns.forEach(t=>{if(!positive(t.v)||!positive(t.b)||t.b>60||!Number.isFinite(t.h)||t.h<0)throw Error('Проверьте скорости, высоты и крен разворотов.');});
  const legs=config.legs.map(l=>({...l})),turns=config.turns.map(t=>({...t,...turn(t.v,t.b)}));
  const adjustments=[],issues=[];
  function adjust(index,value){
   if(!Number.isFinite(value)||value<1){issues.push(`Для замыкания участок «${legs[index].name}» должен иметь длину ${Math.round(value)} м. Увеличьте размеры круга или уменьшите радиусы разворотов.`);return;}
   if(Math.abs(legs[index].s-value)>.01)adjustments.push({index,name:legs[index].name,before:legs[index].s,after:value});
   legs[index].s=value;
  }
  const rx=turns[0].r-turns[1].r-turns[2].r+turns[3].r;
  const ry=turns[0].r+turns[1].r-turns[2].r-turns[3].r;
  if(config.closureAnchor==='top')adjust(0,legs[2].s+legs[3].s-legs[5].s-legs[6].s-rx);
  else{
   const top=legs[0].s+legs[5].s+legs[6].s+rx,existing=legs[2].s+legs[3].s,ratio=existing>0?legs[2].s/existing:.5;
   adjust(2,top*ratio);adjust(3,top*(1-ratio));
  }
  if(config.sideAnchor==='left')adjust(1,legs[4].s-ry);else adjust(4,legs[1].s+ry);
  legs.forEach(l=>l.t=l.s/(l.w/3.6));
  if(turns[1].h<turns[0].h)issues.push('На участке 1 → 2 задан набор: H2 должна быть не ниже H1.');
  if(turns[3].h>turns[2].h)issues.push('На участке 3 → 4 задано снижение: H4 должна быть не выше H3.');
  const blocks=[{indices:[0],from:0,to:turns[0].h},{indices:[1],from:turns[0].h,to:turns[1].h},{indices:[2,3],from:turns[1].h,to:turns[2].h},{indices:[4],from:turns[2].h,to:turns[3].h},{indices:[5,6],from:turns[3].h,to:0}];
  blocks.forEach(block=>{
   block.duration=block.indices.reduce((s,i)=>s+legs[i].t,0);
   block.vz=block.duration>0?(block.to-block.from)/block.duration:0;
   block.rate=Math.abs(block.vz);
   if(block.duration===0&&block.to!==block.from)issues.push(`${block.indices.map(i=>legs[i].name).join(' + ')}: для изменения высоты нужна ненулевая длина участка.`);
   let offset=0;block.indices.forEach(i=>{legs[i].block=block;legs[i].offset=offset;offset+=legs[i].t;});
  });
  const segments=[];let x=0,y=0,heading=Math.PI/2-config.course*rad,time=0,distance=0;
  function addLeg(i){const l=legs[i];segments.push({type:'leg',index:i,name:l.name,start:time,duration:l.t,x,y,heading,speed:l.w,bank:0,block:l.block,offset:l.offset,distance:l.s});x+=Math.cos(heading)*l.s;y+=Math.sin(heading)*l.s;time+=l.t;distance+=l.s;}
  function addTurn(i){const t=turns[i];segments.push({type:'turn',index:i,name:`${i+1}-й разворот`,start:time,duration:t.t,x,y,heading,speed:t.v,bank:t.b,r:t.r,altitude:t.h,distance:t.arc});const end=heading+Math.PI/2;x+=t.r*(Math.sin(end)-Math.sin(heading));y+=t.r*(Math.cos(heading)-Math.cos(end));heading=end;time+=t.t;distance+=t.arc;}
  addLeg(0);addTurn(0);addLeg(1);addTurn(1);addLeg(2);addLeg(3);addTurn(2);addLeg(4);addTurn(3);addLeg(5);addLeg(6);
  function sample(t){
   t=Math.max(0,Math.min(time,t));const s=segments.find(s=>t<s.start+s.duration-1e-8)||segments[segments.length-1];const dt=Math.min(s.duration,Math.max(0,t-s.start)),f=s.duration?dt/s.duration:1;
   let px=s.x,py=s.y,h=s.heading,z=0,vz=0;
   if(s.type==='turn'){h+=Math.PI*f/2;px+=s.r*(Math.sin(h)-Math.sin(s.heading));py+=s.r*(Math.cos(s.heading)-Math.cos(h));z=s.altitude;}
   else{px+=Math.cos(h)*s.distance*f;py+=Math.sin(h)*s.distance*f;const b=s.block,bt=s.offset+dt;
    const progress=b.duration?Math.max(0,Math.min(1,bt/b.duration)):1;
    z=b.from+(b.to-b.from)*progress;vz=b.vz;
   }
   if(t>=time&&Math.hypot(x,y)<1e-6){px=0;py=0;z=0;vz=0;}
   const landed=t>=time&&Math.hypot(x,y)<1e-6;
   return {x:px,y:py,z,heading:h,course:((90-h/rad)%360+360)%360,speed:landed?0:s.speed,bank:landed?0:s.bank,vz,name:s.name,time:t,segment:s};
  }
  const points=[];for(let t=0;t<time;t+=Math.max(.5,time/1800))points.push(sample(t));points.push(sample(time));
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),zs=points.map(p=>p.z);
  const solvedConfig={...config,legs:legs.map(l=>({name:l.name,s:l.s,w:l.w}))};
  return {config:solvedConfig,legs,turns,segments,points,total:time,distance,issues,adjustments,closure:Math.hypot(x,y),end:{x,y},bounds:{minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys),maxZ:Math.max(...zs)},sample};
 }
 const api={build,turn};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FlightModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);

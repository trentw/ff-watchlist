'use strict';
const $ = id => document.getElementById(id);
const example = 'QB  Caleb Williams  CHI - QB\nRB  Jahmyr Gibbs  DET - RB\nWR  Ja’Marr Chase  CIN - WR\nBN  Justin Jefferson  MIN - WR';
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
let lastInput = null;
let requestVersion = 0;
function input() {
  return {lineup:$('lineup').value, season:Number($('season').value), week:Number($('week').value),
    scoring:$('scoring').value, source:'sleeper', projections:$('projections').value||null};
}
function updateScoreboard() {
  $('board-week').textContent = $('week').value.padStart(2,'0');
  $('board-season').textContent = $('season').value;
  $('board-scoring').textContent = {std:'STD',half:'½ PPR',ppr:'PPR'}[$('scoring').value] || '—';
}
function restore() {
  try {
    if (!location.hash) return;
    const data = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    for (const key of ['lineup','season','week','scoring','projections']) if(data[key]!=null) $(key).value=data[key];
    $('status').textContent='Shared lineup loaded. Choose “Find my matchups” for this week’s data.';
  } catch { $('status').textContent='This share link could not be read. Paste a lineup below.'; }
}
function playerList(players, bench=false) {
  const list=el('ul',undefined,'players'+(bench?' bench':''));
  for (const p of players) {
    const row=el('li',undefined,'player');
    const portrait=el('div',undefined,'portrait');
    portrait.dataset.playerName=p.name; portrait.dataset.team=p.team;
    portrait.append(el('span',p.jersey!=null?'#'+p.jersey:p.pos==='DST'?'DST':'#?','number'));
    const info=el('div',undefined,'player-info');
    info.append(el('span',p.name,'player-name'),el('span',`${p.team} · ${p.slot}${p.jersey!=null?' · #'+p.jersey:''}`,'meta'));
    row.append(portrait,info,el('span',p.proj==null?'—':Number(p.proj).toFixed(1),'value'));
    list.append(row);
  }
  return list;
}
function teamBadge(team) {
  const badge=el('span',undefined,'team-badge'); badge.dataset.team=team;
  badge.append(el('span',team)); return badge;
}
function render(data) {
  $('results').replaceChildren(); $('issues').replaceChildren();
  const notices=[...(data.warnings||[]),...(data.issues||[]).map(i=>`Line ${i.line}: ${i.text} — ${i.message}`)];
  if(data.unmatched?.length) notices.push('No projection for: '+data.unmatched.map(p=>p.name).join(', ')+'. Totals include known points only.');
  if(notices.length) {
    const box=el('div',undefined,'notice'); box.append(el('strong','Check your lineup and coverage'));
    const list=el('ul'); for(const s of notices)list.append(el('li',s)); box.append(list); $('issues').append(box);
  }
  const scoring={std:'Standard',half:'Half-PPR',ppr:'PPR'}[data.scoring]||data.scoring;
  const source=data.attribution||data.source||'Unknown source';
  $('status').textContent=`Week ${data.week} · ${data.season} · ${scoring} · ${source}${data.fetched_at?' · fetched '+new Date(data.fetched_at).toLocaleString():''}. Kickoffs: Pacific.`;
  for(const slot of data.slots||[]) {
    const section=el('section',undefined,'slot'); section.append(el('h3',slot.label,'slot-title'));
    slot.games.forEach((g,i)=>{
      const occupied=g.starters.length||g.bench.length;
      const featured=i===0&&occupied;
      const card=el('article',undefined,'game'+(featured?' featured':'')+(!occupied?' emptygame':''));
      if(featured) {const strip=el('div',undefined,'game-strip');strip.append(el('span','First on your dial'),el('span',g.starters.length?'STARTERS IN PLAY':'BENCH ONLY'));card.append(strip);}
      const head=el('div',undefined,'game-head'),title=el('div');
      const heading=el('h3',undefined,'matchup-title');heading.append(teamBadge(g.away),el('span','at','versus'),teamBadge(g.home));title.append(heading);
      const kick=new Date(g.kick).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/Los_Angeles'});
      title.append(el('div',`${kick} PT${g.network?' · '+g.network:''}`,'kick'));
      const points=el('div',undefined,'points');points.append(el('strong',Number(g.starter_pts).toFixed(1)),el('small',`${g.starters.length} starter${g.starters.length===1?'':'s'} · proj. pts`));
      head.append(title,points);card.append(head);
      if(g.starters.length)card.append(playerList(g.starters));
      if(g.bench.length)card.append(el('p','On the bench · tiebreak only','bench-label'),playerList(g.bench,true));
      if(!occupied)card.append(el('p','None of your players','empty'));
      section.append(card);
    });
    $('results').append(section);
  }
  if(data.idle?.length) {const idle=el('section',undefined,'slot');idle.append(el('h3','No scheduled game found'),playerList(data.idle));$('results').append(idle);}
}
function safeImage(url) {
  try {const parsed=new URL(url);return parsed.protocol==='https:'&&['a.espncdn.com','sleepercdn.com'].includes(parsed.hostname)?parsed.href:null;} catch {return null;}
}
function addImage(parent,url,cls) {
  const src=safeImage(url); if(!src)return;
  const img=el('img',undefined,cls);img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.src=src;
  img.addEventListener('error',()=>img.remove(),{once:true});parent.prepend(img);
}
async function loadMedia(players,version) {
  try {
    const response=await fetch('/api/media',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({players})});
    if(!response.ok)return;
    const media=await response.json();if(version!==requestVersion)return;
    for(const badge of document.querySelectorAll('.team-badge')) {
      const info=media.teams?.[badge.dataset.team];if(info?.logo)addImage(badge,info.logo,'team-logo');if(info?.name)badge.title=info.name;
    }
    for(const portrait of document.querySelectorAll('.portrait')) {
      const team=media.teams?.[portrait.dataset.team];
      if(team?.color&&/^#?[0-9a-f]{6}$/i.test(team.color))portrait.style.setProperty('--team-color','#'+team.color.replace(/^#/,''));
      const info=(media.players||[]).find(p=>p.name===portrait.dataset.playerName&&p.team===portrait.dataset.team);
      if(info?.headshot)addImage(portrait,info.headshot,'headshot');
    }
  } catch { /* Media is optional: names, jersey numbers and rankings stay usable. */ }
}
$('watch-form').addEventListener('submit',async event=>{
  event.preventDefault();const version=++requestVersion;
  $('submit').disabled=true;$('share').hidden=true;updateScoreboard();
  $('status').textContent='Matching your lineup and fetching this week’s data…';$('issues').replaceChildren();$('results').replaceChildren();
  const body=input();
  try {
    const response=await fetch('/api/watch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();
    if(!response.ok) {
      const detail=data.detail;
      if(data.issues?.length||detail?.issues)render({...data,...detail,slots:[],season:body.season,week:body.week,scoring:body.scoring});
      throw new Error((typeof detail==='string'?detail:detail?.message||'Please check your lineup and try again.')+(detail?.fallback?' '+detail.fallback:''));
    }
    render(data);lastInput=body;$('share').hidden=false;loadMedia(data.players||[],version);
  } catch(error) { $('status').textContent=error.message||'Could not reach the app. Please try again.'; }
  finally { $('submit').disabled=false; }
});
$('example').addEventListener('click',()=>{$('lineup').value=example;$('lineup').focus();});
$('share').addEventListener('click',async()=>{
  if(!lastInput)return;const url=new URL(location.href);url.hash=encodeURIComponent(JSON.stringify(lastInput));
  try {await navigator.clipboard.writeText(url.href);$('status').textContent='Share link copied. It includes your lineup and any pasted projections; anyone with the link can read them.';}
  catch {location.hash=url.hash;$('status').textContent='The share link is in your address bar. Copy it to share your lineup.';}
});
for(const id of ['season','week','scoring'])$(id).addEventListener('change',updateScoreboard);
restore();updateScoreboard();

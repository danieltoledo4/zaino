(function(){
'use strict';
var GIORNI=['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
var GBREVI=['dom','lun','mar','mer','gio','ven','sab'];
var MESI=['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
var TIPI={verifica:'Verifica',interrogazione:'Interrogazione',compito:'Compiti',attivita:'Attività',chiusura:'Niente scuola'};
var TABS=[['oggi','Oggi'],['verifiche','Verifiche'],['settimana','Prossimi giorni'],['orario','Orario']];
var KCODE='zaino-codice',KDATA='zaino-dati',TK='zaino-spunte';
var $app=document.getElementById('app');
var DATA=null;

function h(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function pad(n){return (n<10?'0':'')+n;}
function iso(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function parse(s){var p=String(s).slice(0,10).split('-').map(Number);return new Date(p[0],p[1]-1,p[2]);}
function addDays(d,n){return new Date(d.getFullYear(),d.getMonth(),d.getDate()+n);}
function today0(){var n=new Date();return new Date(n.getFullYear(),n.getMonth(),n.getDate());}
function diff(a,b){return Math.round((parse(iso(b))-parse(iso(a)))/86400000);}
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1);}
function lungo(d){return GIORNI[d.getDay()]+' '+d.getDate()+' '+MESI[d.getMonth()];}
function breve(d){return GBREVI[d.getDay()]+' '+d.getDate()+' '+MESI[d.getMonth()].slice(0,3);}
function quando(d){var n=diff(today0(),d);if(n===0)return 'oggi';if(n===1)return 'domani';if(n===-1)return 'ieri';if(n>1&&n<7)return GIORNI[d.getDay()];return breve(d);}
function traQuanto(d){var n=diff(today0(),d);if(n<0)return 'già fatta';if(n===0)return 'oggi';if(n===1)return 'domani';return 'tra '+n+' giorni';}
function oreTxt(o){var s=o.map(function(x){return x+'ª';});if(s.length===1)return s[0]+' ora';return s.slice(0,-1).join(', ')+' e '+s[s.length-1]+' ora';}
function lsGet(k){try{return localStorage.getItem(k);}catch(e){return null;}}
function lsSet(k,v){try{localStorage.setItem(k,v);}catch(e){}}
function lsDel(k){try{localStorage.removeItem(k);}catch(e){}}

/* ---------- decifratura (PBKDF2 + AES-GCM) ---------- */
function b64(s){var bin=atob(s),u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u;}
function decifra(pkg,codice){
  var enc=new TextEncoder();
  return crypto.subtle.importKey('raw',enc.encode(codice),'PBKDF2',false,['deriveKey']).then(function(base){
    return crypto.subtle.deriveKey({name:'PBKDF2',salt:b64(pkg.salt),iterations:pkg.iter,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['decrypt']);
  }).then(function(key){
    return crypto.subtle.decrypt({name:'AES-GCM',iv:b64(pkg.iv)},key,b64(pkg.data));
  }).then(function(buf){return JSON.parse(new TextDecoder().decode(buf));});
}
function scarica(){return fetch('data.enc.json?t='+Date.now(),{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('http');return r.json();});}

/* ---------- logica scuola ---------- */
function eventi(){return DATA.eventi||[];}
function chiuso(d){var s=iso(d);return eventi().some(function(e){return e.tipo==='chiusura'&&e.data===s;});}
function oreDel(d){var k=d.getDay();if(k===0)return [];return (DATA.orario||{})[k]||[];}
function isScuola(d){return !chiuso(d)&&oreDel(d).some(Boolean);}
function prossimaScuola(d){for(var i=1;i<=45;i++){var x=addDays(d,i);if(isScuola(x))return x;}return null;}
function precedenteScuola(d,min){for(var i=1;i<=45;i++){var x=addDays(d,-i);if(x<min)return null;if(isScuola(x))return x;}return null;}
function materieDel(d){if(!isScuola(d))return [];var ord=[],map={};oreDel(d).forEach(function(m,i){if(!m)return;if(!map[m]){map[m]=[];ord.push(m);}map[m].push(i+1);});return ord.map(function(m){return {nome:m,ore:map[m]};});}
function materia(nome){var ms=DATA.materie||[];for(var i=0;i<ms.length;i++){if(ms[i].nome===nome)return ms[i];}return {nome:nome,colore:'#7c8494',materiale:[]};}
function colore(nome){return materia(nome).colore||'#7c8494';}
function sw(nome){return '<span class="sw" style="--c:'+h(colore(nome))+'"></span>';}
function isRientro(d){return (DATA.rientri||[]).indexOf(d.getDay())>=0&&isScuola(d);}
function isVer(e){return e.tipo==='verifica'||e.tipo==='interrogazione';}
function ordina(a,b){return a.data<b.data?-1:a.data>b.data?1:0;}
function titoloEv(e){return isVer(e)?TIPI[e.tipo]+' di '+e.materia:e.tipo==='attivita'?e.testo:'Compiti di '+e.materia;}

var OFFS={1:[-1],2:[-2,-1],3:[-4,-2,-1],4:[-6,-4,-2,-1]};
var LAB={first:'Leggi, sottolinea e fai uno schema',mid:'Ripeti ad alta voce e fai esercizi',last:'Ripasso finale: ripeti lo schema e rifai 2-3 esercizi',merged:'Studia tutto: leggi, fai lo schema e ripeti'};
function sessioni(ev){
  if(!isVer(ev)||!ev.data)return [];
  var n=Math.min(4,Math.max(1,parseInt(ev.sessioni,10)||3));
  var D=parse(ev.data),T=today0(),offs=OFFS[n],out=[];
  offs.forEach(function(o,i){
    var last=i===offs.length-1,d=addDays(D,o);
    if(!last){for(var k=0;k<3&&(d.getDay()===0||isRientro(d));k++){var p=addDays(d,-1);if(D>T&&p<T)break;d=p;}}
    var label=last?LAB.last:(i===0?LAB.first:LAB.mid);
    if(D>T&&d<T)d=T;
    var key=iso(d),prev=null;
    out.forEach(function(s){if(s.data===key)prev=s;});
    if(prev){prev.label=LAB.merged;return;}
    out.push({id:ev.id+'@'+i,data:key,label:label,ev:ev});
  });
  return out.sort(ordina);
}
function tutteSessioni(){var all=[];eventi().forEach(function(e){all=all.concat(sessioni(e));});return all;}

/* ---------- spunte (su questo dispositivo) ---------- */
var ticks={};
try{ticks=JSON.parse(lsGet(TK)||'{}')||{};}catch(e){ticks={};}
(function(){var lim=iso(addDays(today0(),-40)),ch=false;Object.keys(ticks).forEach(function(k){var m=k.match(/\d{4}-\d{2}-\d{2}/);if(m&&m[0]<lim){delete ticks[k];ch=true;}});if(ch)saveTicks();})();
function saveTicks(){lsSet(TK,JSON.stringify(ticks));}
function cb(key,text,small){return '<label class="check"><input type="checkbox" data-tick="'+h(key)+'"'+(ticks[key]?' checked':'')+'><span class="t">'+text+(small?'<small>'+small+'</small>':'')+'</span></label>';}

/* ---------- stato ---------- */
var S={tab:validTab(location.hash.slice(1)),z:null};
function validTab(t){for(var i=0;i<TABS.length;i++)if(TABS[i][0]===t)return t;return 'oggi';}
function defaultZ(T){var now=new Date();if(isScuola(T)&&now.getHours()<12)return T;return prossimaScuola(T);}

/* ---------- viste ---------- */
function vOggi(T){
  var out='',ts=iso(T),nx=prossimaScuola(T),nxs=nx?iso(nx):null;
  var Z=S.z?parse(S.z):defaultZ(T);
  if(!Z){
    out+='<section class="card"><h2>Zaino</h2><p class="empty">L\'orario delle lezioni non è ancora inserito.</p></section>';
  } else {
    var zs=iso(Z),groups=materieDel(Z);
    var cons=eventi().filter(function(e){return e.tipo==='compito'&&e.data===zs;});
    var ver=eventi().filter(function(e){return isVer(e)&&e.data===zs;});
    var att=eventi().filter(function(e){return e.tipo==='attivita'&&e.data===zs;});
    var keys=[],body='';
    ver.forEach(function(e){body+='<div class="alert">'+sw(e.materia)+'<span>'+h(TIPI[e.tipo])+' di '+h(e.materia)+(e.testo?' · '+h(e.testo):'')+'</span></div>';});
    att.forEach(function(e){body+='<div class="note">'+h(e.testo)+'</div>';});
    groups.forEach(function(g){
      var items=materia(g.nome).materiale||[];
      body+='<div class="grp"><div class="grp-h">'+sw(g.nome)+'<span>'+h(g.nome)+'</span><span class="ore">'+oreTxt(g.ore)+'</span></div>';
      if(!items.length)body+='<p class="empty">Nessun materiale indicato.</p>';
      items.forEach(function(it){var k='z:'+zs+':'+g.nome+':'+it;keys.push(k);body+=cb(k,h(it));});
      body+='</div>';
    });
    if(cons.length){
      body+='<div class="grp"><div class="grp-h"><span class="tag blue">Da consegnare</span></div>';
      cons.forEach(function(e){var k='z:'+zs+':consegna:'+e.id;keys.push(k);body+=cb(k,'Compiti di '+h(e.materia),h(e.testo));});
      body+='</div>';
    }
    if((DATA.sempre||[]).length){
      body+='<div class="grp"><div class="grp-h"><span>Tutti i giorni</span></div>';
      DATA.sempre.forEach(function(it){var k='z:'+zs+':sempre:'+it;keys.push(k);body+=cb(k,h(it));});
      body+='</div>';
    }
    var done=keys.filter(function(k){return ticks[k];}).length;
    var nomiZ=groups.map(function(g){return g.nome;});
    var lascia=(DATA.materie||[]).filter(function(m){return nomiZ.indexOf(m.nome)<0&&(m.materiale||[]).length;});
    if(lascia.length)body+='<div class="leave"><div class="eyebrow">Lascia a casa</div><div class="chips">'+lascia.map(function(m){return '<span class="chip">'+sw(m.nome)+h(m.nome)+'</span>';}).join('')+'</div></div>';
    var prev=precedenteScuola(Z,T),next=prossimaScuola(Z);
    out+='<section class="card" aria-labelledby="zh"><div class="card-h"><div><div class="eyebrow">Zaino</div><h2 id="zh">Per '+h(quando(Z))+'</h2><div class="sub">'+h(cap(lungo(Z)))+(isRientro(Z)?' · con rientro pomeridiano':'')+'</div></div>'+
      '<div class="nav2"><button class="ibtn" data-act="zprev" aria-label="Giorno di scuola precedente"'+(prev?'':' disabled')+'>‹</button><button class="ibtn" data-act="znext" aria-label="Giorno di scuola successivo"'+(next?'':' disabled')+'>›</button></div></div>'+
      (keys.length?'<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="'+keys.length+'" aria-valuenow="'+done+'"><i style="width:'+Math.round(done/keys.length*100)+'%"></i></div><div class="progress-t">'+(done===keys.length?'Zaino pronto!':done+' di '+keys.length+' nello zaino')+'</div>':'')+
      body+'</section>';
  }

  /* pomeriggio */
  var comp=eventi().filter(function(e){return e.tipo==='compito'&&e.data>ts&&diff(T,parse(e.data))<=7;}).sort(function(a,b){var ua=a.data===nxs,ub=b.data===nxs;if(ua!==ub)return ua?-1:1;return ordina(a,b);});
  var stud=tutteSessioni().filter(function(s){return s.data===ts;});
  var p='';
  stud.forEach(function(s){var D=parse(s.ev.data);p+=cb('s:'+s.id,'Studia '+h(s.ev.materia)+' <span class="tag red">'+h(TIPI[s.ev.tipo].toLowerCase())+' '+h(quando(D))+'</span>',h(s.label)+(s.ev.testo?' · '+h(s.ev.testo):''));});
  comp.forEach(function(e){var D=parse(e.data),urg=e.data===nxs;p+=cb('c:'+e.id,sw(e.materia)+' '+h(e.materia)+' <span class="tag '+(urg?'red':'blue')+'">per '+h(quando(D))+'</span>',h(e.testo));});
  var cardPom='<section class="card"><div class="eyebrow">Oggi pomeriggio</div><h2>Compiti e studio</h2>'+(isRientro(T)?'<div class="note">Oggi c\'è il rientro: torni più tardi. Inizia da quelli segnati in rosso.</div>':'')+
    (p||'<p class="empty">Niente compiti o studio per i prossimi giorni.</p>')+'</section>';

  /* porta a casa */
  var cardCasa='';
  if(isScuola(T)){
    var auto=[],perComp=[];
    tutteSessioni().forEach(function(s){if(s.data>=ts&&(!nxs||s.data<nxs)&&auto.indexOf(s.ev.materia)<0)auto.push(s.ev.materia);});
    var nx2=nx?prossimaScuola(nx):null,limC=nx2?iso(nx2):nxs;
    comp.forEach(function(e){if(limC&&e.data<=limC&&auto.indexOf(e.materia)<0){auto.push(e.materia);perComp.push(e.materia);}});
    var oggiM=materieDel(T).map(function(g){return g.nome;});
    var ordine=oggiM.concat((DATA.materie||[]).map(function(m){return m.nome;}).filter(function(n){return oggiM.indexOf(n)<0;})).filter(function(n){return (materia(n).materiale||[]).length;});
    var sel=auto.slice();
    ordine.forEach(function(n){if(ticks['pc:'+ts+':'+n]&&sel.indexOf(n)<0)sel.push(n);});
    var lst='';
    sel.forEach(function(n){
      var m=materia(n),why=auto.indexOf(n)>=0?(perComp.indexOf(n)>=0?' <span class="tag blue">per i compiti</span>':' <span class="tag red">per studiare</span>'):'';
      if(!(m.materiale||[]).length)return;
      lst+='<div class="grp"><div class="grp-h">'+sw(n)+'<span>'+h(n)+why+'</span></div>';
      m.materiale.forEach(function(it){lst+=cb('pz:'+ts+':'+n+':'+it,h(it));});
      lst+='</div>';
    });
    var altre=ordine.filter(function(n){return auto.indexOf(n)<0;});
    var chips=altre.map(function(n){var on=!!ticks['pc:'+ts+':'+n];return '<button class="pick" data-act="pick" data-m="'+h(n)+'" aria-pressed="'+on+'">'+sw(n)+h(n)+'</button>';}).join('');
    cardCasa='<section class="card"><div class="eyebrow">Prima di uscire da scuola</div><h2>Porta a casa</h2>'+
      (lst?'<div class="sub">Ti serve per i compiti e lo studio dei prossimi giorni.</div>'+lst:'<p class="empty">Per i prossimi giorni non ti serve niente di particolare a casa.</p>')+
      '<div class="leave"><div class="eyebrow">Ti serve altro? Tocca la materia</div><div class="chips">'+chips+'</div></div></section>';
  }
  var hr=new Date().getHours();
  var tempoCasa=isScuola(T)&&hr>=11&&hr<17;
  out=tempoCasa?cardCasa+cardPom+out:out+cardPom+cardCasa;

  /* prossime verifiche */
  var up=eventi().filter(function(e){return isVer(e)&&e.data>=ts;}).sort(ordina).slice(0,4);
  var v='';
  up.forEach(function(e){var D=parse(e.data);v+='<div class="row vcard"><div class="grow"><div class="vtitle">'+h(TIPI[e.tipo])+' di '+h(e.materia)+'</div><div class="vdesc">'+h(cap(lungo(D)))+(e.testo?' · '+h(e.testo):'')+'</div></div><div class="count">'+h(traQuanto(D))+'</div></div>';});
  out+='<section class="card"><div class="card-h"><div><div class="eyebrow">In arrivo</div><h2>Prossime verifiche</h2></div><a class="edit-link" href="#verifiche">Piano di studio ›</a></div>'+(v?'<div class="vlist">'+v+'</div>':'<p class="empty">Nessuna verifica in calendario.</p>')+'</section>';
  return out;
}

function vVerifiche(T){
  var ts=iso(T),out='',c='';
  var up=eventi().filter(function(e){return isVer(e)&&e.data>=ts;}).sort(ordina);
  var past=eventi().filter(function(e){return isVer(e)&&e.data<ts;}).sort(ordina).reverse().slice(0,12);
  up.forEach(function(e){
    var D=parse(e.data),ss=sessioni(e);
    c+='<div class="vcard"><div class="row"><div class="grow"><div class="vtitle">'+sw(e.materia)+' '+h(TIPI[e.tipo])+' di '+h(e.materia)+'</div><div class="vdesc">'+h(cap(lungo(D)))+(e.testo?' · '+h(e.testo):'')+'</div></div><div class="count">'+h(traQuanto(D))+'</div></div>';
    if(ss.length){c+='<div class="plan">';ss.forEach(function(s){var d=parse(s.data);c+='<div class="'+(s.data<ts?'past':'')+'">'+cb('s:'+s.id,'<span class="when">'+h(cap(quando(d)))+'</span> '+h(s.label))+'</div>';});c+='</div>';}
    c+='</div>';
  });
  out+='<section class="card"><div class="eyebrow">Piano di studio</div><h2>Verifiche e interrogazioni</h2><div class="sub">Lo studio è diviso in più pomeriggi, così il giorno prima basta ripassare.</div><div class="vlist" style="margin-top:12px">'+(c||'<p class="empty">Nessuna verifica in calendario.</p>')+'</div></section>';
  var comp=eventi().filter(function(e){return e.tipo==='compito'&&e.data>ts;}).sort(ordina),cc='';
  comp.forEach(function(e){var D=parse(e.data);cc+=cb('c:'+e.id,sw(e.materia)+' '+h(e.materia)+' <span class="tag blue">per '+h(quando(D))+'</span>',h(e.testo));});
  out+='<section class="card"><div class="eyebrow">Da fare a casa</div><h2>Compiti</h2>'+(cc||'<p class="empty">Nessun compito in arrivo.</p>')+'</section>';
  if(past.length)out+='<section class="card"><details><summary class="eyebrow" style="cursor:pointer">Già fatte ('+past.length+')</summary><div class="vlist" style="margin-top:10px">'+past.map(function(e){return '<div class="row past"><div class="grow">'+h(TIPI[e.tipo])+' di '+h(e.materia)+(e.testo?' · '+h(e.testo):'')+'</div><div class="mini">'+h(breve(parse(e.data)))+'</div></div>';}).join('')+'</div></details></section>';
  return out;
}

function vSettimana(T){
  var all=tutteSessioni(),rows='';
  for(var i=0;i<14;i++){
    var d=addDays(T,i),ds=iso(d),it='',mm=materieDel(d);
    if(isScuola(d))it+='<div class="mini">'+mm.map(function(g){return sw(g.nome)+' '+h(g.nome);}).join(' &nbsp;')+(isRientro(d)?' · <b>rientro</b>':'')+'</div>';
    else it+='<div class="mini">'+(chiuso(d)?'Niente scuola':(d.getDay()===0?'Domenica':'Niente lezioni'))+'</div>';
    eventi().filter(function(e){return e.data===ds&&e.tipo!=='chiusura';}).sort(function(a,b){var r={verifica:0,interrogazione:0,attivita:1,compito:2};return r[a.tipo]-r[b.tipo];}).forEach(function(e){
      var cls=isVer(e)?'red':e.tipo==='compito'?'blue':'';
      it+='<div class="line-ev '+cls+'">'+(isVer(e)?h(TIPI[e.tipo])+' di '+h(e.materia)+(e.testo?' · '+h(e.testo):''):e.tipo==='compito'?'Consegna '+h(e.materia)+' · '+h(e.testo):h(e.testo))+'</div>';
    });
    all.filter(function(s){return s.data===ds;}).forEach(function(s){it+='<div class="line-ev">Studia '+h(s.ev.materia)+' <span class="mini">per la '+h(TIPI[s.ev.tipo].toLowerCase())+' di '+h(GIORNI[parse(s.ev.data).getDay()])+'</span></div>';});
    rows+='<div class="day'+(i===0?' is-today':'')+'"><div class="d"><span>'+h(GBREVI[d.getDay()])+'</span><b>'+d.getDate()+'</b><span>'+h(MESI[d.getMonth()].slice(0,3))+'</span></div><div class="items">'+it+'</div></div>';
  }
  return '<section class="card"><div class="eyebrow">Due settimane</div><h2>Prossimi giorni</h2><div style="margin-top:8px">'+rows+'</div></section>';
}

function vOrario(T){
  var out='',max=0,orario=DATA.orario||{};
  for(var k=1;k<=6;k++)max=Math.max(max,(orario[k]||[]).length);
  if(max){
    var dow=T.getDay(),days=[1,2,3,4,5,6].filter(function(k){return (orario[k]||[]).some(Boolean);});
    var t='<table class="orario"><thead><tr><th></th>'+days.map(function(k){return '<th class="'+(k===dow?'now':'')+'">'+h(GBREVI[k])+((DATA.rientri||[]).indexOf(k)>=0?' ·R':'')+'</th>';}).join('')+'</tr></thead><tbody>';
    for(var r=0;r<max;r++){t+='<tr><td class="h">'+(r+1)+'ª</td>';days.forEach(function(k){var m=(orario[k]||[])[r]||'';t+=m?'<td style="--c:'+h(colore(m))+'">'+h(m)+'</td>':'<td class="vuota"></td>';});t+='</tr>';}
    t+='</tbody></table>';
    out+='<section class="card"><div class="eyebrow">Settimana</div><h2>Orario delle lezioni</h2>'+((DATA.rientri||[]).length?'<div class="sub">R = rientro pomeridiano</div>':'')+'<div class="tablewrap" style="margin-top:10px">'+t+'</div></section>';
  }
  var mats=(DATA.materie||[]).map(function(m){return '<div class="m"><div class="grp-h">'+sw(m.nome)+'<span>'+h(m.nome)+'</span></div>'+((m.materiale||[]).length?'<ul>'+m.materiale.map(function(x){return '<li>'+h(x)+'</li>';}).join('')+'</ul>':'<p class="empty">Nessun materiale indicato.</p>')+'</div>';}).join('');
  if((DATA.sempre||[]).length)mats+='<div class="m"><div class="grp-h"><span>Tutti i giorni</span></div><ul>'+DATA.sempre.map(function(x){return '<li>'+h(x)+'</li>';}).join('')+'</ul></div>';
  out+='<section class="card"><div class="eyebrow">Cosa serve</div><h2>Materiale per materia</h2><div class="mat" style="margin-top:10px">'+mats+'</div></section>';
  return out;
}

function aggiornatoTxt(){
  if(!DATA.aggiornato)return '';
  var d=new Date(DATA.aggiornato);if(isNaN(d))return '';
  var ore=(Date.now()-d.getTime())/3600000;
  var txt='Compiti e verifiche aggiornati '+h(quando(new Date(d.getFullYear(),d.getMonth(),d.getDate())))+' alle '+pad(d.getHours())+':'+pad(d.getMinutes())+' da Mastercom';
  return ore>36?'<div class="alert" style="justify-content:center">Dati non aggiornati da '+Math.floor(ore/24)+' giorni: avvisa papà.</div><p class="foot">'+txt+'</p>':'<p class="foot">'+txt+'</p>';
}

function render(){
  if(!DATA)return;
  var T=today0(),y=window.scrollY;
  var nav=TABS.map(function(t){return '<a href="#'+t[0]+'"'+(S.tab===t[0]?' aria-current="page"':'')+'>'+t[1]+'</a>';}).join('');
  var body=S.tab==='verifiche'?vVerifiche(T):S.tab==='settimana'?vSettimana(T):S.tab==='orario'?vOrario(T):vOggi(T);
  $app.innerHTML='<header class="top"><div class="in"><div><div class="hello">Ciao '+h(DATA.studente||'')+'</div><div class="today">'+h(cap(lungo(T)))+'</div></div></div></header>'+
    '<nav class="tabs" aria-label="Sezioni"><div class="in">'+nav+'</div></nav>'+
    '<main class="in">'+body+aggiornatoTxt()+'<p class="foot"><button class="edit-link" data-act="logout">Cambia codice</button></p></main>';
  window.scrollTo(0,y);
}

/* ---------- schermata codice ---------- */
function vCodice(err){
  $app.innerHTML='<main class="in lock"><section class="card"><div class="eyebrow">Zaino</div><h2>Inserisci il codice</h2><div class="sub">Te lo dà papà. Serve solo la prima volta su questo telefono.</div>'+
    '<form id="codeform" class="field"><label for="codice">Codice</label><input id="codice" name="codice" type="password" autocomplete="current-password" required>'+
    (err?'<div class="err">'+h(err)+'</div>':'')+'<div class="actions"><button class="btn primary" type="submit">Apri</button></div></form></section></main>';
  var i=document.getElementById('codice');if(i)i.focus();
}

function avvia(codice){
  scarica().then(function(pkg){
    return decifra(pkg,codice).then(function(d){
      DATA=d;lsSet(KCODE,codice);lsSet(KDATA,JSON.stringify(d));render();
    },function(){lsDel(KCODE);vCodice('Codice sbagliato. Riprova.');});
  },function(){
    var cache=lsGet(KDATA);
    if(cache){try{DATA=JSON.parse(cache);render();return;}catch(e){}}
    $app.innerHTML='<main class="in"><section class="card"><h2>Nessuna connessione</h2><p class="empty">Riprova quando sei connessa a internet.</p></section></main>';
  });
}

/* ---------- eventi UI ---------- */
$app.addEventListener('click',function(ev){
  var el=ev.target.closest('[data-act]');if(!el)return;
  var a=el.getAttribute('data-act'),T=today0();
  if(a==='zprev'||a==='znext'){var Z=S.z?parse(S.z):defaultZ(T);var n=a==='znext'?prossimaScuola(Z):precedenteScuola(Z,T);if(n){S.z=iso(n);render();}return;}
  if(a==='pick'){var pk='pc:'+iso(T)+':'+el.getAttribute('data-m');if(ticks[pk])delete ticks[pk];else ticks[pk]=1;saveTicks();render();return;}
  if(a==='logout'){lsDel(KCODE);lsDel(KDATA);DATA=null;vCodice('');return;}
});
$app.addEventListener('change',function(ev){
  var t=ev.target;
  if(t.hasAttribute('data-tick')){var k=t.getAttribute('data-tick');if(t.checked)ticks[k]=1;else delete ticks[k];saveTicks();render();}
});
$app.addEventListener('submit',function(ev){
  if(ev.target.id!=='codeform')return;
  ev.preventDefault();var c=document.getElementById('codice').value.trim();if(!c)return;
  $app.querySelector('button[type=submit]').disabled=true;avvia(c);
});
window.addEventListener('hashchange',function(){S.tab=validTab(location.hash.slice(1));render();window.scrollTo(0,0);});
var lastDay=iso(today0()),lastFetch=Date.now();
function refresh(){
  var d=iso(today0());if(d!==lastDay){lastDay=d;S.z=null;render();}
  var c=lsGet(KCODE);
  if(c&&Date.now()-lastFetch>30*60*1000){lastFetch=Date.now();scarica().then(function(p){return decifra(p,c);}).then(function(dd){DATA=dd;lsSet(KDATA,JSON.stringify(dd));render();}).catch(function(){});}
}
setInterval(refresh,5*60*1000);
document.addEventListener('visibilitychange',function(){if(!document.hidden)refresh();});

var saved=lsGet(KCODE),cache=lsGet(KDATA);
if(cache&&saved){try{DATA=JSON.parse(cache);render();}catch(e){}}
if(saved)avvia(saved);else vCodice('');
})();

"use strict";
/* Shared browser core for the signed-in pages (account, catalog).
 *
 * Everything in here is page-agnostic: the Supabase REST plumbing and session
 * refresh, the magic-link/OAuth return leg, formatting helpers, the theme
 * switch, and local-midnight date maths. Page-specific state — which views
 * exist, the ledger, the organizer side — stays inline on the page.
 *
 * This is a plain classic script, not a module: the site has no build step,
 * and the pages that load it pin 'self' in their CSP script-src alongside the
 * sha256 of their own inline block (see scripts/csp-hash.py).
 */

/* ---------- plumbing (mirrors shop.html) ---------- */
var SUPA="https://psiattienhrooetmjvue.supabase.co";
var ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzaWF0dGllbmhyb29ldG1qdnVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyODgzMzMsImV4cCI6MjEwMDg2NDMzM30.8sT1GNVTwj4uv4Ua25qphYewNci_NeavNX2UwIiSnIw";
var PROC_NAMES={cash:"Cash",venmo:"Venmo",paypal:"PayPal",stripe:"Stripe",tap_to_pay:"Card · Tap to Pay",ebt:"EBT",check:"Check",zelle:"Zelle",cashapp:"Cash App",apple_cash:"Apple Cash",bank_transfer:"Bank transfer",trade:"Trade",comped:"Comped",other:"Other"};

function rest(path,opts,token){
  opts=opts||{};
  var headers={apikey:ANON,Authorization:"Bearer "+(token||ANON),"Content-Type":"application/json"};
  for(var h in (opts.headers||{}))headers[h]=opts.headers[h];
  return fetch(SUPA+"/rest/v1/"+path,{method:opts.method||"GET",headers:headers,body:opts.body});
}
function getSession(){try{return JSON.parse(localStorage.getItem("ss-session"));}catch(e){return null;}}
function setSession(s){if(s)localStorage.setItem("ss-session",JSON.stringify(s));else localStorage.removeItem("ss-session");}
function refreshSession(s){
  return fetch(SUPA+"/auth/v1/token?grant_type=refresh_token",{
    method:"POST",headers:{apikey:ANON,"Content-Type":"application/json"},
    body:JSON.stringify({refresh_token:s.refresh_token})
  }).then(function(r){
    if(!r.ok){setSession(null);return null;}
    return r.json().then(function(j){
      var ns={access_token:j.access_token,refresh_token:j.refresh_token,user_id:j.user.id};
      setSession(ns);return ns;
    });
  });
}
function authRest(path,opts){
  var s=getSession();
  if(!s)return Promise.reject(new Error("no session"));
  return rest(path,opts,s.access_token).then(function(r){
    if(r.status!==401)return r;
    return refreshSession(s).then(function(ns){
      if(!ns){show("v-login");throw new Error("signed out");}
      return rest(path,opts,ns.access_token);
    });
  });
}
function money(cents){return "$"+((cents||0)/100).toFixed(2);}
function moneyPlain(cents){return ((cents||0)/100).toFixed(2);}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){
  return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function $(id){return document.getElementById(id);}

/* ---------- appearance ---------- */
/* Three states, matching the app's Settings > Appearance: Dark, Light, or
   Match device. The head script already applied the stored choice before
   paint; this only wires the control and persists changes. */
(function(){
  var sel=$("themeSel");
  if(!sel)return;
  var stored=null;
  try{stored=localStorage.getItem("ss-theme");}catch(e){}
  sel.value=stored||"dark";
  sel.addEventListener("change",function(){
    var v=sel.value;
    try{localStorage.setItem("ss-theme",v);}catch(e){}
    if(v==="system"){document.documentElement.removeAttribute("data-theme");}
    else{document.documentElement.setAttribute("data-theme",v);}
  });
})();

/* ---------- OAuth return leg (mirrors shop.html, minus the slug) ---------- */
var oauthError=null;
(function(){
  var hash=location.hash||"";
  if(hash.indexOf("access_token")<0&&hash.indexOf("error")<0)return;
  var h=new URLSearchParams(hash.slice(1));
  var at=h.get("access_token"),rt=h.get("refresh_token");
  if(at&&rt){
    var uid="";
    try{uid=JSON.parse(atob(at.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))).sub||"";}catch(e){}
    setSession({access_token:at,refresh_token:rt,user_id:uid});
  }else{
    oauthError=h.get("error_description")||"Sign-in didn't complete. Try again.";
    oauthError=decodeURIComponent(String(oauthError).replace(/\+/g," "));
  }
  history.replaceState(null,"",location.pathname);
})();

/* ---------- date helpers (local-midnight day boundaries, like the app) ---------- */
function dstr(d){
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
function parseDstr(s){
  var p=s.split("-");return new Date(+p[0],+p[1]-1,+p[2]);
}
function dayBounds(d){
  var a=new Date(d.getFullYear(),d.getMonth(),d.getDate());
  var b=new Date(a);b.setDate(b.getDate()+1);
  return [a.toISOString(),b.toISOString()];
}
function sameLocalDay(iso,d){
  var x=new Date(iso);
  return x.getFullYear()===d.getFullYear()&&x.getMonth()===d.getMonth()&&x.getDate()===d.getDate();
}
function timeOf(iso){
  return new Date(iso).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"});
}


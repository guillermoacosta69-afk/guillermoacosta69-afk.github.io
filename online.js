/* Salas online de la app, con Supabase Realtime (solo "broadcast", sin "presence").
   Ofrece la misma forma que las salas de Claude: join(nombre) devuelve una sala con
   presence(objeto), peers(), onPeers(cb) y leave().
   - Cada celular manda su estado completo cuando cambia (máximo 4 veces por segundo) y además
     lo repite cada 2 segundos, así nadie se queda trabado si se pierde un mensaje o entra tarde.
   - Un jugador sigue "en la sala" mientras siga llegando su estado (se da por ido a los 7 s).
   - Si la conexión inicial falla, reintenta solo hasta 3 veces. */
(function () {
  const C = window.ONLINE_CONFIG || {};
  if (!C.url || !C.key || !window.supabase || !window.supabase.createClient) return;
  let client = null;
  const getClient = () => client || (client = window.supabase.createClient(C.url, C.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  }));
  const myKey = "k" + Math.random().toString(36).slice(2, 12);
  const HEARTBEAT = 2000, STALE = 7000, THROTTLE = 250;

  function subscribeOnce(name, onMsg){
    return new Promise((resolve, reject) => {
      const ch = getClient().channel("cdp:" + name, { config: { broadcast: { self: false, ack: true } } });
      ch.on("broadcast", { event: "st" }, ({ payload }) => onMsg("st", payload))
        .on("broadcast", { event: "bye" }, ({ payload }) => onMsg("bye", payload));
      let done = false;
      const to = setTimeout(() => { if (!done) { done = true; try { getClient().removeChannel(ch); } catch (e) {} reject(new Error("timeout")); } }, 12000);
      ch.subscribe(status => {
        if (status === "SUBSCRIBED") { if (!done) { done = true; clearTimeout(to); resolve(ch); } else if (ch._onResub) ch._onResub(); }
        else if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") && !done) {
          done = true; clearTimeout(to); try { getClient().removeChannel(ch); } catch (e) {} reject(new Error(status));
        }
      });
    });
  }

  async function join(name){
    const states = {};            /* clave -> { o: estado, seq, t: cuándo llegó } */
    let listeners = [], last = null, lastJson = "", seq = 0, timer = null, lastSent = 0, closed = false, hb = null, ch = null;
    let api = null;
    const notify = () => { if (!api) return; const ps = api.peers(); listeners.forEach(f => { try { f({ peers: ps }); } catch (e) {} }); };
    const onMsg = (ev, p) => {
      if (!p || !p.k || p.k === myKey) return;
      if (ev === "bye") { delete states[p.k]; notify(); return; }
      const prev = states[p.k];
      if (prev && prev.seq > p.seq && prev.boot === p.boot) return;   /* mensaje viejo que llegó tarde */
      states[p.k] = { o: p.o, seq: p.seq, boot: p.boot, t: Date.now() };
      notify();
    };
    const boot = Math.random().toString(36).slice(2, 8);
    const send = async (force) => {
      timer = null;
      if (closed || !last || !ch) return;
      const json = JSON.stringify(last);
      if (!force && json === lastJson) return;
      lastSent = Date.now(); seq++;
      let res = "error";
      try { res = await ch.send({ type: "broadcast", event: "st", payload: { k: myKey, boot, seq, o: last } }); } catch (e) {}
      if (res === "ok") lastJson = json;
      else if (!closed && !timer) timer = setTimeout(() => send(true), 500);   /* no llegó: reintenta */
    };
    let lastErr = null;
    for (let attempt = 0; attempt < 3 && !ch; attempt++) {
      try { ch = await subscribeOnce(name, onMsg); }
      catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 800 + attempt * 700)); }
    }
    if (!ch) throw lastErr || new Error("no se pudo conectar");
    ch._onResub = () => { lastJson = ""; send(true); };
    hb = setInterval(() => {
      send(true);
      const now = Date.now(); let gone = false;
      for (const k of Object.keys(states)) if (now - states[k].t > STALE) { delete states[k]; gone = true; }
      if (gone) notify();
    }, HEARTBEAT);
    api = {
      presence(obj) {
        last = JSON.parse(JSON.stringify(obj));
        const wait = Math.max(0, THROTTLE - (Date.now() - lastSent));
        if (!timer) timer = setTimeout(() => send(false), wait);
        return Promise.resolve();
      },
      peers() {
        const out = Object.entries(states).map(([k, s]) => ({ peer: k, isMe: false, sameTab: false, presence: s.o }));
        if (last) out.unshift({ peer: myKey, isMe: true, sameTab: true, presence: last });
        return out;
      },
      onPeers(cb) { listeners.push(cb); return () => { listeners = listeners.filter(f => f !== cb); }; },
      async leave() {
        closed = true; clearTimeout(timer); clearInterval(hb);
        try { await ch.send({ type: "broadcast", event: "bye", payload: { k: myKey } }); } catch (e) {}
        try { await getClient().removeChannel(ch); } catch (e) {}
      },
      connected() { return !closed; }
    };
    return api;
  }
  window.OnlineRoom = { join };
})();

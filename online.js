/* Salas online de la app de Android, con Supabase Realtime.
   Ofrece la misma forma que las salas de Claude: join(nombre) devuelve una sala con
   presence(objeto), peers(), onPeers(cb) y leave(). Cada jugador publica su estado
   completo como "presencia"; nada se guarda en una base de datos. */
(function () {
  const C = window.ONLINE_CONFIG || {};
  if (!C.url || !C.key || !window.supabase || !window.supabase.createClient) return;
  let client = null;
  const getClient = () => client || (client = window.supabase.createClient(C.url, C.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 20 } }
  }));
  const myKey = "k" + Math.random().toString(36).slice(2, 12);

  function join(name) {
    return new Promise((resolve, reject) => {
      const ch = getClient().channel("cdp:" + name, { config: { presence: { key: myKey } } });
      let peers = [], listeners = [], errListeners = [], last = null, timer = null, lastSent = 0, closed = false;
      const rebuild = () => {
        const st = ch.presenceState(), out = [];
        for (const [key, metas] of Object.entries(st)) {
          const m = metas && metas[metas.length - 1];
          if (!m) continue;
          const p = Object.assign({}, m); delete p.presence_ref;
          out.push({ peer: key, isMe: key === myKey, sameTab: key === myKey, presence: p });
        }
        peers = out;
        listeners.forEach(f => { try { f({ peers: out }); } catch (e) {} });
      };
      /* Solo "sync": llega con el estado completo ya actualizado, sin huecos al re-publicar */
      ch.on("presence", { event: "sync" }, rebuild);
      /* Envía como mucho 4 actualizaciones por segundo, nunca repite lo mismo y, si Supabase
         no confirma el envío (límite de mensajes o corte), lo reintenta hasta que llegue */
      let lastJson = "", pendingJson = "";
      const flush = async () => {
        timer = null;
        if (closed || !last) return;
        const json = JSON.stringify(last);
        if (json === lastJson) return;
        lastSent = Date.now(); pendingJson = json;
        let res = "error";
        try { res = await ch.track(last); } catch (e) {}
        if (res === "ok") { if (pendingJson === json) lastJson = json; }
        else if (!closed && !timer) timer = setTimeout(flush, 500);
      };
      const api = {
        presence(obj) {
          last = JSON.parse(JSON.stringify(obj));
          const wait = Math.max(0, 250 - (Date.now() - lastSent));
          if (!timer) timer = setTimeout(flush, wait);
          return Promise.resolve();
        },
        peers() { return peers.slice(); },
        onPeers(cb, err) { listeners.push(cb); if (err) errListeners.push(err); return () => { listeners = listeners.filter(f => f !== cb); }; },
        async leave() { closed = true; clearTimeout(timer); try { await ch.untrack(); } catch (e) {} try { await getClient().removeChannel(ch); } catch (e) {} },
        connected() { return !closed; }
      };
      let settled = false;
      const to = setTimeout(() => { if (!settled) { settled = true; reject(new Error("timeout")); } }, 12000);
      ch.subscribe(status => {
        if (status === "SUBSCRIBED") {
          if (!settled) { settled = true; clearTimeout(to); resolve(api); }
          else if (last) { lastSent = 0; lastJson = ""; flush(); } /* al reconectarse, vuelve a publicar su estado */
        }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (!settled) { settled = true; clearTimeout(to); reject(new Error(status)); }
          else errListeners.forEach(f => { try { f(status); } catch (e) {} });
        }
      });
    });
  }
  window.OnlineRoom = { join };
})();

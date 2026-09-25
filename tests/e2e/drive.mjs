#!/usr/bin/env node
/**
 * UI-Durchlauf über das DevTools-Protokoll: klickt, tippt und prüft die echte
 * Oberfläche. Erwartet eine laufende App mit --remote-debugging-port=9223.
 *
 *   node tests/e2e/drive.mjs [port]
 *
 * Ausgabe: eine Zeile je Prüfung, darunter die Summe. Exit-Code 1 bei Fehlern.
 */
const PORT = Number(process.argv[2] ?? 9223)

const results = []
const consoleErrors = []
const pageErrors = []

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail === undefined ? undefined : String(detail) })
  console.log(`${ok ? '  ok  ' : ' FEHLER'}  ${name}${detail !== undefined ? ` — ${String(detail).slice(0, 220)}` : ''}`)
}

async function findPageTarget() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      /* App startet noch */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Kein Seite-Ziel an Port ${PORT} — läuft die App mit --remote-debugging-port=${PORT}?`)
}

function connect(url) {
  const socket = new WebSocket(url)
  let nextId = 1
  const waiting = new Map()

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && waiting.has(message.id)) {
      const { resolve, reject } = waiting.get(message.id)
      waiting.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
      return
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '))
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params.exceptionDetails
      pageErrors.push(detail.exception?.description ?? detail.text)
    }
  })

  const ready = new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))

  return {
    ready,
    send(method, params = {}) {
      const id = nextId++
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }))
    },
    close: () => socket.close()
  }
}

// ---------------------------------------------------------------- Helfer im Renderer
const HELPERS = `
  window.__h = {
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    // Wert so setzen, dass React es mitbekommt (nativer Setter + input-Ereignis).
    type(selector, value) {
      const node = document.querySelector(selector)
      if (!node) return false
      const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value)
      node.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    },
    click(selector) {
      const node = document.querySelector(selector)
      if (!node) return false
      node.click()
      return true
    },
    clickByText(selector, text) {
      const node = [...document.querySelectorAll(selector)].find((n) => (n.textContent ?? '').trim().includes(text))
      if (!node) return false
      node.click()
      return true
    },
    // Überlagerungen wegräumen: die Flucht-Taste ist dafür da, und jeder
    // Abschnitt fängt auf einem freien Tisch an.
    async dismissOverlays() {
      for (let attempt = 0; attempt < 4; attempt++) {
        if (!document.querySelector('.overlay')) return true
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await new Promise((r) => setTimeout(r, 150))
      }
      return !document.querySelector('.overlay')
    },
    clickTitle(title) {
      const node = document.querySelector(\`[title="\${title}"]\`)
      if (!node) return false
      node.click()
      return true
    },
    selectValue(value) {
      const select = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === value))
      if (!select) return false
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value)
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    },
    // Offene Freigabekarten des Agenten bestätigen (Test-Umgebung).
    allowPermissions() {
      const buttons = [...document.querySelectorAll('button')].filter((b) => /^(Erlauben|Allow)$/.test(b.textContent.trim()))
      buttons.forEach((b) => b.click())
      return buttons.length
    },
    sendButton() {
      return document.querySelector('.composer .send')
    },
    send(text) {
      if (!window.__h.type('.composer__input', text)) return 'kein Eingabefeld'
      const button = window.__h.sendButton()
      if (!button) return 'kein Sendeknopf'
      if (button.disabled) return 'Sendeknopf deaktiviert'
      button.click()
      return true
    },
    lastAssistant() {
      const nodes = [...document.querySelectorAll('.msg-assistant')]
      return nodes.length ? nodes[nodes.length - 1].innerText.replace(/\\s+/g, ' ').trim() : ''
    },
    rowCount() {
      return document.querySelectorAll('.chat-row').length
    }
  }
`

async function main() {
  const target = await findPageTarget()
  const cdp = connect(target.webSocketDebuggerUrl)
  await cdp.ready
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Log.enable')
  console.log(`Verbunden mit: ${target.url}\n`)

  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'Auswertung fehlgeschlagen')
    }
    return result.result.value
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const waitFor = async (expression, timeout, label) => {
    const started = Date.now()
    let last
    while (Date.now() - started < timeout) {
      last = await evaluate(`return (${expression})`)
      if (last) return last
      await wait(200)
    }
    throw new Error(`${label} (Letzter Wert: ${JSON.stringify(last)})`)
  }
  const shot = async (name) => {
    // Ein verstecktes Fenster zeichnet keine Bilder — dann nicht ewig warten.
    const ergebnis = await Promise.race([cdp.send('Page.captureScreenshot', { format: 'png' }), wait(5000).then(() => null)])
    if (!ergebnis) return
    const { data } = ergebnis
    const fs = await import('node:fs')
    fs.mkdirSync('/tmp/hearth/e2e', { recursive: true })
    fs.writeFileSync(`/tmp/hearth/e2e/${name}.png`, Buffer.from(data, 'base64'))
  }

  await evaluate(HELPERS)

  // ------------------------------------------------------------------ Grundzustand
  check('Rahmen und Seitenleiste vorhanden', await evaluate(`return Boolean(document.querySelector('.app-shell .sidebar'))`))

  // Ein neues Gespräch beginnt im Chat — nicht im Agent des letzten Laufs.
  const stufe = () => evaluate(`
    const knoepfe = [...document.querySelectorAll('button')]
    const an = (name) => {
      const feld = knoepfe.find((n) => n.textContent.trim() === name)
      return feld ? (feld.dataset.active ?? feld.getAttribute('aria-pressed')) : null
    }
    return { chat: an('Chat'), agent: an('Agent') }
  `)
  // Erst auf die Startseite: nur dort beginnt ein neues Gespräch.
  await evaluate(`
    const zeile = [...document.querySelectorAll('.sidebar .nav-item')].find((n) => (n.textContent ?? '').trim().startsWith('Neu'))
    zeile?.click()
    return true
  `)
  await wait(500)
  await waitFor(`[...document.querySelectorAll('button')].some((n) => n.textContent.trim() === 'Agent')`, 8000, 'Eingabfeld mit Modusstufe')
  // Die Denkstufe: fünf Zustände, je Modell, und bei Modellen ohne Denken zu.
  // Nicht den ersten Chip im Baum, sondern den sichtbaren: ein wiederhergestelltes
  // Gespräch kann einen verdeckten Composer mit gleichem Muster hinterlassen.
  await evaluate(`
    const chip = [...document.querySelectorAll('.pill')].find((n) => n.offsetParent)
    // Öffnen, nicht umschalten: stand das Menü schon offen, schlösse ein Klick es.
    if (!document.querySelector('.modellmenue')) chip?.click()
    return true
  `)
  // Warten auf das Denkfeld, nicht auf eine Sekundenfrist: die Modelliste kann
  // beim ersten Öffnen erst beim Anbieter nachsehen müssen.
  await waitFor(`Boolean([...document.querySelectorAll('.pill')].find((n) => n.offsetParent))`, 6000, 'Modellknopf sichtbar').catch(() => null)
  await waitFor(`Boolean(document.querySelector('.modellmenue'))`, 8000, 'Modellmenü öffnet').catch(() => null)
  // Im Modellmenü die Zeile „Aufwand" mit der Stufe,
  // die seitlich ihr Untermenü aufklappt — mit Erklärung, Häkchen, „Standard".
  const denkfeld = await evaluate(`return (async () => {
    const menue = document.querySelector('.modellmenue')
    if (!menue) return { knoepfe: 0 }
    const zeile = [...menue.querySelectorAll('.modellmenue__zeile')].find((n) => /Aufwand|Effort/.test(n.textContent))
    const wert = zeile?.querySelector('.modellmenue__wert')?.textContent
    zeile?.click()
    await new Promise((loes) => setTimeout(loes, 250))
    const seite = document.querySelector('.stufenliste')
    const namen = [...(seite?.querySelectorAll('.stufenliste__punkt .stufenliste__name') ?? [])].map((n) => n.textContent.trim())
    return {
      zeile: Boolean(zeile),
      wert,
      knoepfe: namen.length,
      namen,
      erklaert: Boolean(seite?.querySelector('.stufenliste__grund')?.textContent),
      standard: Boolean(seite?.querySelector('.stufenliste__marke')),
      haken: seite?.querySelectorAll('[aria-checked="true"]').length ?? 0,
      seitlich: seite ? Math.round(seite.getBoundingClientRect().left - menue.getBoundingClientRect().right) : null
    }
  })()`)
  check('Die Denkstufe hat fünf Zustände', denkfeld?.knoepfe === 5, JSON.stringify(denkfeld))
  check(
    'Aufwand sitzt im Modellmenü und klappt seitlich auf, mit Häkchen und „Standard"',
    denkfeld?.zeile === true && Boolean(denkfeld?.wert) && denkfeld?.erklaert === true && denkfeld?.standard === true && denkfeld?.haken === 1,
    JSON.stringify(denkfeld)
  )

  await evaluate(`
    const knopf = [...document.querySelectorAll('.stufenliste__punkt')].find((n) => /^(Aus|Off)$/.test(n.querySelector('.stufenliste__name').textContent.trim()))
    knopf?.click()
    return true
  `)
  await wait(600)
  // Die Prüfung braucht ein gewähltes Modell. War keines gewählt (neues Profil,
  // oder ein frischer Ordner), wird das erste mit Werkzeugen gewählt — sonst
  // meldet sie einen Widerspruch, wo nur nichts ausgewählt war.
  await evaluate(`return (async () => {
    const s = await window.desk.settings.get()
    if (s.defaultModelChat) return false
    const liste = await window.desk.models.list()
    const ziel = liste.find((m) => m.capabilities?.thinking) ?? liste[0]
    if (!ziel) return false
    await window.desk.settings.set({ defaultModelChat: ziel.providerId + '|' + ziel.id })
    return true
  })()`)
  const gemerkt = await evaluate(`return (async () => {
    const s = await window.desk.settings.get()
    const bezug = s.defaultModelChat ?? ''
    return { vorgabe: s.effort, eigene: s.reasoning[bezug] ?? null, bezug }
  })()`)
  // Ohne gewähltes Modell ist die Prüfung gegenstandslos: es gibt kein Modell,
  // für das eine Stufe gelten könnte. Sie dann als bestanden zu melden wäre
  // falsch — also steht sie ausdrücklich als übersprungen im Protokoll.
  if (gemerkt?.bezug) {
    check('Die Denkstufe gilt nur für dieses Modell', gemerkt?.eigene === 'off', JSON.stringify(gemerkt))
  } else {
    console.log(' skip  Die Denkstufe gilt nur für dieses Modell — kein Modell gewählt')
    results.push({ name: 'Die Denkstufe gilt nur für dieses Modell', ok: true, detail: 'übersprungen: kein Modell gewählt' })
  }
  await evaluate(`return (async () => { await window.desk.settings.set({ reasoning: {} }); return true })()`)
  await evaluate(`document.body.click(); return true`)
  await wait(300)

  const anfangs = await stufe()
  check('Neues Gespräch beginnt im Chat', anfangs?.chat === 'true' && anfangs?.agent !== 'true', JSON.stringify(anfangs))
  // Und bleibt dabei, nachdem Agent benutzt war.
  await evaluate(`const c = [...document.querySelectorAll('button')].find((n) => n.textContent.trim() === 'Agent'); c?.click(); return true`)
  // Ein Lauf braucht ein gewähltes Modell — sonst endet jede Prüfung, die eine
  // Antwort erwartet, im Leeren. In einem frischen Ordner ist keines gesetzt.
  await evaluate(`return (async () => {
    const s = await window.desk.settings.get()
    if (s.defaultModelChat) return false
    const liste = await window.desk.models.list()
    const ziel = liste.find((m) => m.capabilities?.thinking) ?? liste[0]
    if (!ziel) return false
    await window.desk.settings.set({ defaultModelChat: ziel.providerId + '|' + ziel.id })
    return true
  })()`)

  await wait(400)
  await evaluate(`
    const zeile = [...document.querySelectorAll('.sidebar .nav-item')].find((n) => (n.textContent ?? '').trim().startsWith('Neu'))
    zeile?.click()
    return true
  `)
  await wait(600)
  const nachAgent = await stufe()
  check('Nach benutztem Agent beginnt das nächste Gespräch wieder im Chat', nachAgent?.chat === 'true' && nachAgent?.agent !== 'true', JSON.stringify(nachAgent))

  // Einklappen ist ein eigenen Zustand: Die Rasterfelder sind zwar gesetzt,
  // aber ein einziger fehlender Eintrag genügt, damit die Hauptfläche in die
  // Nullspalte rutscht und das Eingabefeld dreißig Pixel breit dasteht.
  const klappmass = async () => evaluate(`return {
    haupt: Math.round(document.querySelector('.main').getBoundingClientRect().width),
    feld: Math.round(document.querySelector('.composer')?.getBoundingClientRect().width ?? 0),
    mitte: Math.round((document.querySelector('.composer')?.getBoundingClientRect().left ?? 0) + (document.querySelector('.composer')?.getBoundingClientRect().width ?? 0) / 2),
    fenstermitte: Math.round(window.innerWidth / 2)
  }`)
  // ------------------------------------------------------------------ gesetztes PDF
  // Ein PDF wird bei Hestia nicht ausgedruckt, sondern gesetzt: ein Deckel,
  // jedes Kapitel auf neuer Seite, Bilder aus dem Ordner im Satz.
  {
    const fs = await import('node:fs/promises')
    const ordner = '/tmp/heia-buch-pruefung'
    await fs.mkdir(ordner, { recursive: true })
    // Ein eigenes Bild, aus der Hand erzeugt — keine Fremdgrafik.
    await fs.writeFile(
      `${ordner}/kugel.png`,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAF0lEQVR4nGP8z8DAwMDAxMDAwMAAAAkAAy4b0QAAAAAASUVORK5CYII=',
        'base64'
      )
    )
    // Das Muster wird als Datenwort gebaut und dann codiert übergeben — ein
    // echter Zeilensprung im Prüferquell wäre ein Syntaxfehler in der Seite.
    const muster = [
      '# Prüfbuch',
      '',
      '## Erstes Kapitel',
      '',
      'Text des ersten Kapitels.',
      '',
      '![Ein Bild](kugel.png)',
      '',
      '## Zweites Kapitel',
      '',
      'Text des zweiten Kapitels.',
      ''
    ].join('\n')
    const buch = await evaluate(`return (async () => {
      const ref = await window.desk.documents.create({
        kind: 'pdf',
        title: 'Prüfbuch',
        untertitel: 'Eine Prüfung',
        markdown: ${JSON.stringify(muster)},
        path: '${ordner}/Pruefbuch.pdf'
      })
      return JSON.stringify({ byte: ref.bytes, pfad: ref.path })
    })()`)
    const { byte, pfad } = JSON.parse(buch ?? '{}')
    const daten = await fs.readFile(pfad ?? '/dev/null').catch(() => null)
    const rohr = (daten ?? Buffer.alloc(0)).toString('latin1')
    const seiten = (rohr.match(/\/Type \/Page[^s]/g) ?? []).length
    check(
      // Ohne Vorlage ein normales Papier: kein Deckblatt, Kapitel laufen durch.
      'Ein PDF ohne Vorlage wird als normales Dokument gesetzt',
      rohr.startsWith('%PDF-') && seiten >= 1 && seiten < 3,
      JSON.stringify({ byte, seiten })
    )
    check('Das Bild aus dem Ordner steckt in der PDF', rohr.includes('/Image'), JSON.stringify({ byte, bild: rohr.includes('/Image') }))
    await fs.rm(ordner, { recursive: true, force: true })
  }

  // Der Einstellungsbereich: zweispaltig, Suchfeld, Gruppen, Zeilen mit Steuerung
  // rechts. Vorher wird geschlossen, was noch offen ist — ein früherer Lauf kann
  // das Fenster mit vollster Suchfeldintringenliegend zurückgelassen haben.
  await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true`)
  await wait(300)
  // Der Fußknopf **schaltet** das Menü. Ein früherer Lauf kann es offen
  // hinterlassen haben — dann würde ein Klick es zufallen lassen. Und ohne
  // geöffnete Leiste gibt es keinen Fußknopf, also erst die Leiste.
  for (let versuch = 0; versuch < 3; versuch++) {
    const zustand = await evaluate(`return document.querySelector('.app-shell').dataset.sidebar`)
    if (zustand === 'open') break
    await evaluate(`document.querySelector('.titlebar button')?.click(); return true`)
    await wait(400)
  }
  await evaluate(`if (document.querySelector('.fußmenue')) document.body.click(); return true`)
  await wait(300)
  await evaluate(`
    const knopf = [...document.querySelectorAll('.sidebar__footer button')][0]
    knopf?.click()
    return true
  `)
  await wait(400)
  const fuess = await evaluate(`
    const m = document.querySelector('.fußmenue')
    return m ? [...m.querySelectorAll('button')].map((n) => n.textContent.trim()) : []
  `)
  check('Das Fußmenü führt zu den Einstellungen', (fuess ?? []).some((x) => x.includes('Einstellungen')), JSON.stringify(fuess))
  await evaluate(`
    const m = document.querySelector('.fußmenue')
    const k = [...(m?.querySelectorAll('button') ?? [])].find((n) => n.textContent.includes('Einstellungen'))
    k?.click()
    return true
  `)
  await waitFor(`Boolean(document.querySelector('.einstellungen'))`, 6000, 'Einstellungsbereich öffnet')
  const bereich = await evaluate(`return {
    gruppen: [...document.querySelectorAll('.einstellungen__kopf')].map((n) => n.textContent.trim()),
    punkte: [...document.querySelectorAll('.einstellungen__punkt')].map((n) => n.textContent.trim()),
    zeilen: document.querySelectorAll('.einstellungen .zeile').length,
    steuerung: document.querySelectorAll('.einstellungen .zeile__steuerung').length,
    suchfeld: Boolean(document.querySelector('.einstellungen__suche input'))
  }`)
  check('Der Einstellungsbereich ist zweispaltig mit Gruppen', (bereich?.gruppen ?? []).length >= 3 && (bereich?.punkte ?? []).length >= 6, JSON.stringify(bereich))
  check('Jede Zeile trägt ihre Steuerung rechts', (bereich?.steuerung ?? 0) >= 3 && (bereich?.zeilen ?? 0) === (bereich?.steuerung ?? -1), JSON.stringify(bereich))
  // Eine Zeile wirklich umschalten und nachsehen, dass es gilt.
  const vorher = await evaluate(`return (async () => (await window.desk.settings.get()).panelSourceView)()`)
  await evaluate(`
    const schalter = document.querySelector('.einstellungen .umschalter')
    schalter?.click()
    return true
  `)
  await wait(500)
  const nachher = await evaluate(`return (async () => (await window.desk.settings.get()).panelSourceView)()`)
  check('Ein Schalter in den Einstellungen gilt wirklich', nachher !== vorher, JSON.stringify({ vorher, nachher }))
  await evaluate(`
    const schalter = document.querySelector('.einstellungen .umschalter')
    schalter?.click()
    return true
  `)
  await wait(300)
  await evaluate(`document.querySelector('.einstellungen__titelzeile .icon-btn')?.click(); return true`)
  await wait(300)

  await evaluate(`document.querySelector('.titlebar button')?.click(); return true`)
  await wait(500)
  const zugeklappt = await klappmass()
  check('Bei eingeklappter Leiste füllt die Hauptfläche das Fenster', (zugeklappt?.haupt ?? 0) > 700, JSON.stringify(zugeklappt))
  check('Bei eingeklappter Leiste bleibt das Eingabfeld breit', (zugeklappt?.feld ?? 0) > 500, JSON.stringify(zugeklappt))
  check('Bei eingeklappter Leiste steht das Eingabfeld mittig', Math.abs((zugeklappt?.mitte ?? 0) - (zugeklappt?.fenstermitte ?? 0)) < 40, JSON.stringify(zugeklappt))
  await evaluate(`document.querySelector('.titlebar button')?.click(); return true`)
  await wait(500)
  const ausgeklappt = await klappmass()
  check('Nach dem Aufklappen ist die Leiste wieder da', (ausgeklappt?.haupt ?? 0) < (zugeklappt?.haupt ?? 0) && (ausgeklappt?.feld ?? 0) > 500, JSON.stringify(ausgeklappt))
  const nav = await evaluate(`return [...document.querySelectorAll('.nav-item__label')].map(e => e.textContent.trim())`)
  check('Seitenleisten-Punkte benannt', nav?.length >= 5, nav?.join(' | '))
  check('Kein Platzhaltertext im Baum', !(await evaluate(`return /lorem|TODO|undefined/i.test(document.body.innerText)`)))

  // Ein fehlender Übersetzungsschlüssel fiele als roher Schlüssel auf. Dass jede
  // Ansicht überhaupt einen Titel hat, prüfen die Wörterbuch-Tests — ein
  // Rundgang durch die Punkte hier würde Modal öffnen und spätere Prüfungen
  // stören.
  const viewTitle = await evaluate(`return document.querySelector('.titlebar span[style*="capitalize"]')?.textContent?.trim() ?? ''`)
  check('Ansichtstitel ist gesetzt und kein roher Schlüssel', viewTitle.length > 0 && !viewTitle.includes('.'), viewTitle)

  // -------------------------------------------------------------------- Ein Lauf
  await evaluate(`window.__h.click('.nav-item'); return true`)
  await wait(700)
  // Bewusst Chat: die Einstellung „letzter Modus" könnte von Hand verstellt sein.
  await evaluate(`return window.__h.clickByText('.segmented button', 'Chat')`)
  await wait(300)
  check('Chat-Modus ist aktiv', await evaluate(`return document.querySelector('.segmented button[data-active="true"]')?.textContent?.trim() === 'Chat'`))

  // Agent ohne Ordner darf sich nicht wegschicken lassen
  await evaluate(`return window.__h.clickByText('.segmented button', 'Agent')`)
  await wait(400)
  check(
    'Agent ohne Ordner weist vor dem Senden darauf hin',
    await evaluate(`return Boolean(document.querySelector('.composer__blocked'))`)
  )
  check(
    'Senden ist dann außer Reichweite',
    await evaluate(`return document.querySelector('.send')?.disabled === true`)
  )
  await evaluate(`return window.__h.clickByText('.segmented button', 'Chat')`)
  await wait(300)
  check('Zurück im Chat ist der Hinweis weg', await evaluate(`return !document.querySelector('.composer__blocked')`))

  const sendResult = await evaluate(`return window.__h.send('Nenne eine Zahl zwischen 1 und 10.')`)
  check('Senden nimmt die Eingabe an', sendResult === true, sendResult)

  // Zeichen lebt nur während des Laufes: mitten im Lauf messen, nicht danach
  await waitFor(`Boolean(document.querySelector('.msg-assistant__mark[data-live]'))`, 20000, 'Zeichen geht im Lauf an').catch(() => null)
  const liveMark = await evaluate(`
    const mark = document.querySelector('.msg-assistant__mark[data-live]')
    if (!mark) return null
    const ember = mark.querySelector('.logo-mark__ember')
    const kern = mark.querySelector('.logo-mark__kern')
    return {
      ember: ember ? getComputedStyle(ember).animationName : null,
      kern: kern ? getComputedStyle(kern).animationName : null
    }
  `)
  check(
    'Die Flamme flackert während des Laufes',
    // Die Flamme der Herdschale flackert, ihr Kern züngelt; die Schale steht.
    liveMark != null && liveMark.ember === 'ember-breathe' && liveMark.kern === 'glut-kern',
    JSON.stringify(liveMark)
  )

  await waitFor(`window.__h.lastAssistant().length > 0 && !window.__h.sendButton()?.dataset.stop?.includes('true')`, 120000, 'Lauf endet')
  const answer = await evaluate(`return window.__h.lastAssistant()`)
  check('Antwort mit Inhalt', (answer?.length ?? 0) > 1, answer)
  const calmMark = await evaluate(`
    const mark = document.querySelector('.msg-assistant__mark[data-live]')
    const ember = document.querySelector('.msg-assistant__mark .logo-mark__ember')
    return { stillLive: Boolean(mark), ember: ember ? getComputedStyle(ember).animationName : null }
  `)
  check('Zeichen steht nach der Antwort still', calmMark != null && !calmMark.stillLive && calmMark.ember === 'none', JSON.stringify(calmMark))

  // Durchsatzzeile: jede fertige Antwort trägt ihre Rate und die Einzelwerte
  await waitFor(`Boolean(document.querySelector('.msg-metrics'))`, 15000, 'Durchsatzzeile erscheint').catch(() => null)
  const metricsLine = await evaluate(`
    const line = document.querySelector('.msg-metrics')
    if (!line) return null
    return {
      rate: Number(line.dataset.rate),
      output: Number(line.dataset.output),
      duration: Number(line.dataset.duration),
      estimated: line.dataset.estimated,
      visible: line.offsetParent !== null,
      text: line.textContent
    }
  `)
  check(
    'Durchsatzzeile mit Rate und Einzelwerten',
    metricsLine != null && metricsLine.visible && metricsLine.rate > 0 && metricsLine.output > 0 && metricsLine.duration > 0,
    JSON.stringify(metricsLine)
  )
  check(
    'Rate rechnerisch passend zu Token und Dauer',
    metricsLine != null && Math.abs(metricsLine.output / (metricsLine.duration / 1000) - metricsLine.rate) < Math.max(1.5, metricsLine.rate * 0.05),
    metricsLine != null ? `${metricsLine.output} / ${metricsLine.duration} ms ≈ ${metricsLine.rate}` : 'keine Zeile'
  )

  // Zwei Läufe kurz hintereinander (laufender Lauf darf nicht blockieren)
  const antwortenVorher = await evaluate(`return document.querySelectorAll('.msg-assistant').length`)
  const second = await evaluate(`return window.__h.send('Nochmal eine Zahl, nur die Zahl.')`)
  check('Zweiter Lauf direkt möglich', second === true, second)
  // Auf die **neue** Antwort warten: gleich nach dem Senden erfüllt die vorige
  // die Bedingung „hat Text, kein Stop-Knopf" noch — dann griff der Export ins
  // Leere, je nachdem, wie schnell das Start-Ereignis kam.
  await waitFor(
    `document.querySelectorAll('.msg-assistant').length > ${antwortenVorher} && window.__h.lastAssistant().length > 1 && !window.__h.sendButton()?.dataset.stop?.includes('true')`,
    120000,
    'zweiter Lauf endet'
  )

  // ------------------------------------------------- Dokument über das Exportmenü
  // Deterministisch: kein Modell beteiligt, nur die Oberfläche.
  await evaluate(`
    const last = [...document.querySelectorAll('.msg-assistant')].slice(-1)[0]
    const button = [...(last?.querySelectorAll('button') ?? [])].find(b => /Exportieren|Export/.test(b.textContent))
    button?.click()
    return true
  `)
  await wait(400)
  const menuItems = await evaluate(`return [...document.querySelectorAll('.menu__item')].map(b => b.textContent.trim())`)
  check('Exportmenü listet drei Formate', (menuItems?.length ?? 0) === 3, menuItems?.join(' | '))
  await evaluate(`
    const item = [...document.querySelectorAll('.menu__item')].find(b => /Markdown/.test(b.textContent))
    item?.click()
    return true
  `)
  try {
    await waitFor(`Boolean(document.querySelector('.doc-panel'))`, 20000, 'Export öffnet das Panel')
    await wait(1200)
    const panel = await evaluate(`return {
      title: document.querySelector('.doc-panel__title')?.textContent,
      body: (document.querySelector('.doc-panel__body')?.innerText ?? '').length,
      actions: document.querySelectorAll('.doc-panel__actions button').length,
      hasIframe: Boolean(document.querySelector('.doc-panel iframe'))
    }`)
    check('Export öffnet das Panel mit der Datei', panel?.title?.endsWith('.md') && panel.actions >= 4, JSON.stringify(panel))
    // Der Bildschirm wird geteilt: die Vorschau bekommt die Hälfte, nicht das
    // ganze Fenster.
    const anteil = await evaluate(`return (() => {
      const feld = document.querySelector('.doc-panel')
      const haupt = document.querySelector('.haupt') || document.querySelector('main')
      if (!feld || !haupt) return { fehlend: true }
      return { teil: feld.getBoundingClientRect().width / haupt.getBoundingClientRect().width }
    })()`)
    check('Die Vorschau bekommt die Hälfte des Bildschirms', Math.abs((anteil?.teil ?? 0) - 0.5) < 0.12, JSON.stringify(anteil))

    check('Panel zeigt den exportierten Text', (panel?.body ?? 0) >= 1, panel?.body)
    await shot('panel')

    // Dasselbe als PDF: hier zeichnet Hestia die Blätter selbst, nicht der
    // Chromium-Betrachter — also muss nachgezählt werden, was wirklich steht.
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true`)
    await wait(400)
    await evaluate(`
      const letzte = [...document.querySelectorAll('.msg-assistant')].pop()
      const exportieren = [...letzte.querySelectorAll('button')].find((n) => /Exportieren/.test(n.textContent ?? ''))
      exportieren?.click()
      return true
    `)
    await wait(400)
    await evaluate(`
      const einträge = [...document.querySelectorAll('button, [role="menuitem"], .menu button')].filter((n) => /PDF/i.test((n.textContent ?? '')))
      einträge[einträge.length - 1]?.click()
      return true
    `)
    await waitFor(`Boolean(document.querySelector('.pdf-page'))`, 30000, 'PDF seitenweise')
    const blätter = await evaluate(`return {
      anzahl: document.querySelectorAll('.pdf-page').length,
      zähler: document.querySelector('.pdf-count')?.textContent,
      schatten: getComputedStyle(document.querySelector('.pdf-page')).boxShadow !== 'none',
      iframe: document.querySelectorAll('.doc-panel iframe').length
    }`)
    check('PDF erscheint als Blattstapel, nicht im Fremdviewer', (blätter?.anzahl ?? 0) >= 1 && blätter.schatten && blätter.iframe === 0, JSON.stringify(blätter))
    check('Blattstapel zählt die Seiten', /\d+\s+Seit/.test(String(blätter?.zähler)), String(blätter?.zähler))
    // Die Blätter entstehen nacheinander; unter Last (ein Modell lädt gerade)
    // kam die Prüfung früher als die erste Plakette.
    await waitFor(`document.querySelectorAll('.pdf-sheet__badge').length > 0`, 15000, 'Plaketten gezeichnet').catch(() => null)
    check('Jede Seite trägt ihre Plakette', await evaluate(`
      const plaketten = [...document.querySelectorAll('.pdf-sheet__badge')]
      const ziffern = '0123456789'
      return plaketten.length > 0 && plaketten.every((n) => {
        const text = (n.textContent ?? '').trim()
        const trenner = text.indexOf(' / ')
        if (!text.startsWith('Seite ') || trenner < 0) return false
        const vorne = text.slice(6, trenner)
        const hinten = text.slice(trenner + 3)
        return vorne.length > 0 && hinten.length > 0 && [...vorne, ...hinten].every((z) => ziffern.includes(z))
      })
    `))

    // Mit der Maus an der Breite ziehen: über das Protokoll, nicht über gebaute
    // Zeiger — nur echte Eingabegeräte treffen die Zeigerfang-Logik.
    const anfang = await evaluate(`return {
      x: Math.round(document.querySelector('.doc-panel__grip').getBoundingClientRect().left + 4),
      y: Math.round(document.querySelector('.doc-panel__grip').getBoundingClientRect().top + 60),
      breite: Math.round(document.querySelector('.doc-panel').getBoundingClientRect().width),
      spielraum: window.innerWidth - 520
    }`)
    const zeiger = (type, x) => cdp.send('Input.dispatchMouseEvent', { type, x, y: anfang.y, button: 'left', clickCount: 1, buttons: type === 'mouseReleased' ? 0 : 1 })
    // Gezogen wird in die Richtung, in der wirklich Platz ist: war die Vorschau
    // schon so breit, wie das Fenster hergibt, bringt ein Zug nach links nichts —
    // dann ist Schrumpfen der Nachweis, daß die Kante folgt.
    // Oben ist bei 1100 Schluß, unten bei 320: gezogen wird in die Richtung,
    // in der noch Raum ist — sonst meldet die Prüfung Kaputt, obwohl die Kante
    // nur an ihre Grenze stößt.
    const richtung = anfang.breite >= 1096 ? 1 : anfang.breite <= 324 ? -1 : anfang.breite > anfang.spielraum ? 1 : -1
    await zeiger('mousePressed', anfang.x)
    for (let schritt = 1; schritt <= 10; schritt++) await zeiger('mouseMoved', anfang.x + richtung * schritt * 18)
    await zeiger('mouseReleased', anfang.x + richtung * 180)
    await wait(350)
    const nachDemZiehen = await evaluate(`return {
      breite: Math.round(document.querySelector('.doc-panel').getBoundingClientRect().width),
      ruhig: !document.body.classList.contains('is-resizing')
    }`)
    // Die Kante muß folgen, und zwar in die gezogene Richtung. Auf den genauen
  // Weg kommt es hier nicht an — der wird an der Rechnung selbst geprüft
  // (`breiteAusZeiger`); hier zählt, daß Zeigerfang und Breite zusammenwirken.
  const gewechselt = (nachDemZiehen?.breite ?? 0) - anfang.breite
  check(
    'Vorschau folgt der gezogenen Kante',
    Math.abs(gewechselt) > 20 && Math.sign(gewechselt) === (richtung > 0 ? -1 : 1),
    JSON.stringify({ anfang: anfang.breite, ...nachDemZiehen, gewechselt, richtung })
  )
    check('Nach dem Loslassen gibt der Griff den Cursor frei', Boolean(nachDemZiehen?.ruhig), JSON.stringify(nachDemZiehen))
        const gemerkt = await evaluate(`return (await window.desk.settings.get()).panelWidth`)
    check('Die gezogene Breite bleibt in den Einstellungen', Math.abs((gemerkt ?? 0) - nachDemZiehen.breite) <= 2, JSON.stringify({ gemessen: nachDemZiehen.breite, gemerkt }))
  } catch (e) {
    check('Export öffnet das Panel', false, e.message)
  }

  // ------------------------------------------------- Dokument vom Agenten (mit Modell)
  // Erst das Panel vom Export schließen, sonst gewinnt dessen Titel die Prüfung.
  await evaluate(`window.__h.dismissOverlays(); return true`)
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true`)
  await wait(500)
  await evaluate(`return window.__h.send('Erzeuge ein Word-Dokument mit Titel Prüfstück aus dem Chat.')`)
  try {
    // Im Chat legt der Agent Dokumente ohne Rückfrage an; sollte
    // doch eine Freigabekarte kommen, wird sie bestätigt.
    await waitFor(`window.__h.allowPermissions() >= 0 && (document.querySelector('.doc-panel__title')?.textContent ?? '').endsWith('.docx')`, 120000, 'Agent-Dokument öffnet das Panel')
    const agentPanel = await evaluate(`return document.querySelector('.doc-panel__title')?.textContent`)
    check('Agent-Dokument erscheint im Panel', String(agentPanel ?? '').endsWith('.docx'), String(agentPanel))
  } catch (e) {
    check('Agent-Dokument erscheint im Panel', false, e.message)
  }

  // ------------------------------------------------- Zeitlinie der Werkzeugschritte
  // Eigener Agent-Lauf in einem ordentlichen Ordner: nur mit echten Werkzeugen
  // lässt sich prüfen, dass die Schritte gebündelt und ohne Rohjson dastehen.
  let marke = 'Abschnitt beginnen'
  // Beides vor dem try: der unbedingt-ausgeführte Teil muss damit aufräumen.
  const fs = await import('node:fs')
  const ordner = '/tmp/heia-zeitlinie'
  try {
    fs.mkdirSync(ordner, { recursive: true })
    marke = 'Lauf anstoßen'
    await evaluate(`
      const c = await window.desk.chats.create({ mode: 'agent', title: 'Zeitlauf', folder: '/tmp/heia-zeitlinie' })
      await window.desk.chats.setPermission(c.id, 'everything')
      window.__laufId = c.id
      await window.desk.messages.send({ chatId: c.id, effort: 'low', text: 'Erstelle im Arbeitsordner die Datei zeitlauf.md mit dem Wort Zeit. Erstelle danach mit create_document ein Dokument mit dem Titel Zeit und genau einem Satz.' })
      return c.id
    `)
    marke = 'Chat öffnen und Zeitlinie abwarten'
    // Gezeichnet wird nur im geöffneten Chat: die Seitenleistenzeile anklicken.
    // Ein Ausdruck mit eigener Wiederholung: pollweise klicken und der App die
    // Reaktion lassen, statt ihr im Halbsekundentakt dazwischenzufunken.
    const geoeffnet = await evaluate(`
      const warte = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      for (let versuch = 0; versuch < 40; versuch++) {
        const zeile = [...document.querySelectorAll('.chat-row')].find((n) => (n.textContent ?? '').includes('Zeitlauf'))
        if (zeile) { zeile.click(); await warte(400); return true }
        await warte(400)
      }
      return false
    `)
    check('Zeitlauf-Chat öffnet sich', Boolean(geoeffnet), String(geoeffnet))
    await waitFor(`Boolean(document.querySelector('.timeline__step'))`, 120000, 'Zeitlinie erscheint beim Lauf')

    marke = 'Laende Zeitlinie ablesen'
    const laufend = await evaluate(`return {
      block: document.querySelectorAll('.timeline').length,
      zeile: document.querySelector('.timeline__summary')?.textContent?.trim(),
      schritt: document.querySelector('.timeline__step')?.textContent?.trim(),
      status: document.querySelector('.timeline__step')?.dataset?.status,
      punkt: getComputedStyle(document.querySelector('.timeline__step[data-status="done"] .timeline__dot') ?? document.body).backgroundColor
    }`)
    check('Zeitlinie zeigt gebündelte Schritte', (laufend?.block ?? 0) >= 1 && Boolean(laufend?.schritt), JSON.stringify(laufend))
    // Die Zusammenfassung zählt, was geschehen ist — also erst ab dem ersten
    // erledigten Schritt. Vorher stand dort schon „1 Datei geschrieben“, während
    // noch auf die Freigabe gewartet wurde.
    check('Solange nichts erledigt ist, behauptet die Zeitlinie nichts', laufend?.status !== 'pending' || !laufend?.zeile, String(laufend?.zeile))
    await waitFor(`Boolean(document.querySelector('.timeline__step[data-status="done"]'))`, 120000, 'ein Schritt ist erledigt').catch(() => null)
    const zusammen = await evaluate(`return document.querySelector('.timeline__summary')?.textContent?.trim()`)
    check('Zeitlinie fasst in einer Zeile zusammen', Boolean(zusammen) && zusammen.length > 3, String(zusammen))
    check('Ein erledigter Schritt ist nicht in Fehlerfarbe', await evaluate(`
      const dot = document.querySelector('.timeline__step[data-status="done"] .timeline__dot')
      if (!dot) return 'noch keiner fertig'
      const farbe = getComputedStyle(dot).backgroundColor
      return farbe !== 'rgb(180, 83, 26)'
    `))

    // Nach dem Fertigmelden: kein roher Aufruf, keine aneinandergelaufenen Sätze
    marke = 'Dokumentkarte prüfen'
    const karte = await evaluate(`
      const k = document.querySelector('.doc-card')
      if (!k) return { karten: 0 }
      return {
        karten: document.querySelectorAll('.doc-card').length,
        zeichen: Boolean(k.querySelector('.doc-card__mark svg')),
        zweiZeilen: Boolean(k.querySelector('.doc-card__zeilen')),
        meta: k.querySelector('.doc-card__meta')?.textContent ?? ''
      }
    `)
    const angelegt = await evaluate(`
      const d = await window.desk.chats.get(window.__laufId)
      const letzte = d.messages[d.messages.length - 1]
      return (letzte?.parts ?? []).some((p) => p.type === 'document')
    `)
    check(
      'Dokumentkarte nennt Art und Größe unter dem Namen',
      !angelegt || ((karte?.karten ?? 0) >= 1 && karte.zeichen && karte.zweiZeilen && /Dokument · /.test(karte.meta)),
      angelegt ? JSON.stringify(karte) : 'Modell hat diesmal kein Dokument angelegt — Prüfung übersprungen'
    )

    // Die Vorschau muss in ihr Feld passen. Der Schaden war still: Der
    // Papierstapel wuchs über die Fensterunterkante hinaus, und die letzte
    // Zeile — die Seitenzählerleiste — lag 524 px außerhalb des Bildschirms.
    marke = 'Vorschau einpassen'
    await evaluate(`document.querySelector('.doc-card')?.click(); return true`)
    const panelDa = await waitFor(`Boolean(document.querySelector('.doc-panel'))`, 12000, 'Vorschau öffnet sich')
    if (panelDa) {
      await wait(1500)
      const fugen = await evaluate(`return (function(){
        const kante = (el) => el ? Math.round(el.getBoundingClientRect().bottom) : 0
        const koerper = document.querySelector('.doc-panel__body')
        const stapel = document.querySelector('.pdf-stack')
        const zaehler = document.querySelector('.pdf-count')
        // Geprüft werden die **Hüllen**: was innerhalb des Papierstapels liegt,
        // darf unter die Fensterkante reichen — dafür hat der Stapel seine
        // Scrollstrecke. Ein Blatt, das beim Hineinscrollen verschwindet, ist
        // kein Schaden; ein Feldkörper, der selbst rollt, sehr wohl.
        const huellen = [
          ['panel', document.querySelector('.doc-panel')],
          ['körper', koerper],
          ['stapel', stapel],
          ['zählerin', zaehler]
        ]
        const hinaus = huellen
          .filter(([, el]) => el && kante(el) > window.innerHeight + 1)
          .map(([name]) => name + ' unten=' + kante(huellen.find(([n]) => n === name)[1]))
        return {
          fenster: window.innerHeight,
          panel: kante(document.querySelector('.doc-panel')),
          koerper: kante(koerper),
          zaehler: zaehler ? kante(zaehler) : null,
          rollenAussen: koerper ? koerper.scrollHeight > koerper.clientHeight : false,
          rolltInnen: stapel ? stapel.scrollHeight > stapel.clientHeight : false,
          hinaus
        }
      })()`)
      check('Die Vorschau ragt nicht über die Fensterunterkante', (fugen?.hinaus ?? []).length === 0, JSON.stringify(fugen))
      check('Der Feldkörper rollt nicht selbst', fugen?.rollenAussen === false, JSON.stringify(fugen))
      check('Die Seitenzählerleiste liegt im Bild', !fugen?.zaehler || fugen.zaehler <= fugen.fenster, JSON.stringify(fugen))
    } else {
      check('Vorschau öffnete sich nicht (kein Dokument)', false, 'Karte ohne Panel')
    }
    await evaluate(`document.querySelector('.doc-panel__actions .icon-btn')?.click(); return true`)
    await wait(400)

    marke = 'Auf Ende warten'
    await waitFor(`await (async () => { const d = await window.desk.chats.get(window.__laufId); const last = d.messages[d.messages.length - 1]; return Boolean(last.error || (last.parts ?? []).some((pt) => pt.type === 'metrics')) })()`, 120000, 'Zeitlauf endet')
    marke = 'Rohtext prüfen'
    const roh = await evaluate(`
      const text = [...document.querySelectorAll('.msg-body')].map((n) => n.innerText).join(' | ')
      const namen = ['write_file(', 'read_file(', 'run_command(', 'list_dir(', 'create_document(', 'search_files(']
      return namen.filter((n) => text.includes(n))
    `)
    check('Kein roher Werkzeugaufruf im sichtbaren Text', (roh ?? []).length === 0, JSON.stringify(roh))

    marke = 'Schrittbenennung prüfen'
    const kleidung = await evaluate(`return {
      zusammenfassungen: [...document.querySelectorAll('.timeline__summary')].map((n) => n.textContent.trim()),
      schritte: [...document.querySelectorAll('.timeline__step')].map((n) => n.textContent.trim())
    }`)
    check('Schritte heißen mit Worten statt Parameterhaufen', (kleidung?.schritte ?? []).every((s) => !s.includes('{')), JSON.stringify(kleidung))

  } catch (e) {
    check('Zeitlinie der Werkzeugschritte', false, `${marke}: ${e.message}`)
  } finally {
    // Wegräumen gehört in den unbedingt-ausgeführten Teil: ein Lauf, der wegen
    // einer Prüfung abbricht, darf keinen Chat und keinen Ordner hinterlassen —
    // sonst hängt der nächste Durchlauf an einem vollen Tisch fest.
    await evaluate(`await window.desk.chats.remove(window.__laufId); return true`).catch(() => undefined)
    fs.rmSync(ordner, { recursive: true, force: true })
    // Löschen über die Schnittstelle erfährt die Oberfläche nicht mit: ohne
    // Neuladen zeigt die Seitenleiste die alte Liste, und spätere Prüfungen
    // lesen Chat-Titel, die es längst nicht mehr gibt.
    await cdp.send('Page.reload')
    await wait(1800)
    // Ein Neuladen wischt auch die Helfer der Steuerung weg — also wieder hinsetzen.
    await evaluate(HELPERS)
  }

  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true`)
  await wait(400)
  check('Escape schließt das Panel', await evaluate(`return !document.querySelector('.doc-panel')`))

  // --------------------------------------------------------------------- Einstellungen
  // Vorbedingung: nichts Überlagertes, sonst Klickt auf verdeckten Knöpfen
  // scheitern und die Meldung einen falschen Verdacht lenkt.
  // Jeder Abschnitt braucht einen freien Tisch; die Flucht-Taste ist der Weg.
  const cleared = await evaluate(`return window.__h.dismissOverlays()`)
  check('Flucht-Taste räumt offene Überlagerungen weg', cleared === true)
  // Der Fußknopf öffnet jetzt zuerst das Menü — von dort geht es weiter.
  await evaluate(`window.__h.click('.sidebar__footer button'); return true`)
  await wait(400)
  await evaluate(`
    const punkt = [...document.querySelectorAll('.fußmenue button')].find((n) => n.textContent.includes('Einstellungen'))
    punkt?.click()
    return true
  `)
  const opened = await waitFor(`Boolean(document.querySelector('.overlay .einstellungen'))`, 4000, 'Einstellungen öffnen sich').then(() => true).catch(() => false)
  check('Einstellungen öffnen ein Fenster', opened)
  if (opened) {
    const sections = await evaluate(`return [...document.querySelectorAll('.einstellungen__punkt')].map(b => b.textContent.trim())`)
    check('Einstellungen mit Bereichen', sections?.length >= 2, sections?.join(' | '))
    await shot('einstellungen')

    // Sprache umschalten und Rückwirkung prüfen. Die Wahl sitzt im Abschnitt
    // „Sprache" — erst hinsehen, dann wählen.
    await evaluate(`
      const punkt = [...document.querySelectorAll('.einstellungen__punkt')].find((n) => /^Sprache$|^Language$/.test(n.textContent.trim()))
      punkt?.click()
      return true
    `)
    await wait(400)
    const switched = await evaluate(`return window.__h.selectValue('en')`)
    await wait(600)
    const navEnglish = await evaluate(`return [...document.querySelectorAll('.nav-item__label')].map(e => e.textContent.trim())`)
    check('Sprachwechsel übersetzt die Liste', switched && navEnglish?.some((l) => /Home|Projects|Artifacts/i.test(l)), navEnglish?.join(' | '))
    await evaluate(`return window.__h.selectValue('de')`)
    await wait(500)
    await evaluate(`document.querySelector('.overlay .icon-btn')?.click(); return true`)
    await wait(400)
    check('Einstellungen wieder geschlossen', await evaluate(`return !document.querySelector('.overlay .modal')`), await evaluate(`
      const overlays = [...document.querySelectorAll('.overlay')]
      return overlays.length ? overlays.map((o) => o.className + '|' + (o.querySelector('.modal__title')?.textContent ?? '')).join(', ') : 'keins'
    `))
  }

  // ------------------------------------------------------------------- Leere Eingabe
  const empty = await evaluate(`
    const before = document.querySelectorAll('.msg-user').length
    window.__h.type('.composer__input', '    ')
    const button = window.__h.sendButton()
    const wasDisabled = button?.disabled
    button?.click()
    return { before, after: document.querySelectorAll('.msg-user').length, wasDisabled }
  `)
  check('Leerzeichen sendet nicht', empty?.before === empty?.after, JSON.stringify(empty))

  // ---------------------------------------------------------------------- Umbenennen
  await evaluate(`
    const row = document.querySelector('.chat-row')
    row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    return true
  `)
  await wait(400)
  const editVisible = await evaluate(`return Boolean(document.querySelector('.chat-row__edit'))`)
  check('Doppelklick öffnet die Umbenennung', editVisible)
  if (editVisible) {
    await evaluate(`window.__h.type('.chat-row__edit', 'Geprüft'); return true`)
    await wait(200)
    await evaluate(`
      const input = document.querySelector('.chat-row__edit')
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      return true
    `)
    await wait(600)
    const titles = await evaluate(`return [...document.querySelectorAll('.chat-row__title')].map(e => e.textContent.trim())`)
    check('Umbenannter Titel sichtbar', titles?.includes('Geprüft'), titles?.slice(0, 3).join(' | '))
  }

  // --------------------------------------------------------------------- Suche
  await evaluate(`
    const button = [...document.querySelectorAll('.icon-btn')].find(b => /suchen|search/i.test(b.title ?? ''))
    button?.click()
    return true
  `)
  const searchOpen = await waitFor(`Boolean(document.querySelector('.search-input'))`, 4000, 'Suchfeld öffnet sich').then(() => true).catch(() => false)
  check('Suchfeld öffnet sich', searchOpen)
  if (searchOpen) {
    await evaluate(`window.__h.type('.search-input', 'zzunexistiert'); return true`)
    await wait(700)
    const hits = await evaluate(`return document.querySelectorAll('.modal .result-row').length`)
    const notice = await evaluate(`return document.querySelector('.modal')?.innerText?.slice(0, 80)`)
    check('Suche ohne Treffer meldet das', hits === 0 || !!notice, `Treffer ${hits}, Text: ${notice}`)
    await evaluate(`window.__h.type('.search-input', 'e'); return true`)
    await wait(700)
    const some = await evaluate(`return document.querySelectorAll('.modal .result-row').length`)
    check('Suche mit Treffer zeigt Einträge', some > 0, some)
    await evaluate(`document.querySelector('.overlay .icon-btn')?.click(); return true`)
    await wait(300)
  }

  // ---------------------------------------------------------------------- Artefakte
  await evaluate(`
    const last = [...document.querySelectorAll('.msg-assistant')].slice(-1)[0]
    const button = [...(last?.querySelectorAll('button') ?? [])].find(b => /Artifact/.test(b.textContent))
    button?.click()
    return true
  `)
  await wait(600)
  await evaluate(`
    const item = [...document.querySelectorAll('.nav-item')].find(n => /Artifacts/i.test(n.textContent))
    item?.click()
    return true
  `)
  await wait(700)
  const artifactsShown = await evaluate(`return document.body.innerText.includes('Artifacts')`)
  check('Artifact-Ansicht öffnet sich', artifactsShown)
  await shot('artifacts')

  // ------------------------------------------------------------------------ Projekte
  await evaluate(`
    const item = [...document.querySelectorAll('.nav-item')].find(n => /Projekte|Projects/i.test(n.textContent))
    item?.click()
    return true
  `)
  await wait(600)
  check('Projekt-Ansicht öffnet sich', await evaluate(`return Boolean(document.querySelector('.main'))`))

  // ------------------------------------------------------------------------- Dunkel
  // Über den Fußauslöser und sein Menü in die Einstellungen — der Knopf öffnet
  // nicht mehr direkt das Fenster.
  await evaluate(`document.querySelector('[data-fussausloeser]')?.click(); return true`)
  await wait(400)
  await evaluate(`
    const punkt = [...document.querySelectorAll('.fußmenue button')].find((n) => n.textContent.includes('Einstellungen'))
    punkt?.click()
    return true
  `)
  await wait(500)
  // Das Thema liegt im Abschnitt „Darstellung" und ist eine Segmentgruppe.
  await evaluate(`
    const tab = [...document.querySelectorAll('.einstellungen__punkt')].find(b => /^Darstellung$|^Appearance$/.test(b.textContent.trim()))
    tab?.click()
    return true
  `)
  await wait(400)
  const darkApplied = await evaluate(`
    const button = [...document.querySelectorAll('.einstellungen .segmented button')].find(b => /^(Dunkel|Dark)$/.test(b.textContent.trim()))
    if (!button) return { found: false, labels: [...document.querySelectorAll('.einstellungen .segmented button')].map(b => b.textContent.trim()).slice(0, 8) }
    button.click()
    return { found: true }
  `)
  await waitFor(`document.documentElement.dataset.theme === 'dark'`, 4000, 'dunkles Thema greift').catch(() => null)
  const theme = await evaluate(`return document.documentElement.dataset.theme`)
  check('Dunkles Thema greift', theme === 'dark', JSON.stringify({ darkApplied, theme }))
  await shot('dunkel')
  await evaluate(`
    const light = [...document.querySelectorAll('.modal .segmented button')].find(b => /^(Hell|Light)$/.test(b.textContent.trim()))
    light?.click()
    return true
  `)
  await waitFor(`document.documentElement.dataset.theme === 'light'`, 4000, 'helles Thema greift').catch(() => null)
  await evaluate(`document.querySelector('.overlay .icon-btn')?.click(); return true`)
  // --------------------------------------------------------------------- Chat löschen
  const beforeDelete = await evaluate(`return window.__h.rowCount()`)
  await evaluate(`
    const row = document.querySelector('.chat-row')
    const button = [...(row?.querySelectorAll('.chat-row__actions button') ?? [])].at(-1)
    button?.click()
    return true
  `)
  await wait(700)
  const afterDelete = await evaluate(`return window.__h.rowCount()`)
  check('Chat löschen entfernt die Zeile', afterDelete === beforeDelete - 1, `${beforeDelete} → ${afterDelete}`)

  // ---------------------------------------------------------- Aufklappmenüs im Bild
  // Menüs am unteren Rand müssen nach oben aufklappen, sonst schneidet das Fenster sie ab.
  // Der Eingabebereich existiert nur in Start- und Chat-Ansicht, also dorthin wechseln.
  await evaluate(`
    const item = [...document.querySelectorAll('.nav-item')].find((n) => /^Neu$|^New$/.test(n.textContent.trim()))
    item?.click()
    return true
  `)
  await waitFor(`Boolean(document.querySelector('.composer'))`, 5000, 'Eingabebereich erscheint').catch(() => null)
  await wait(300)
  const plusFound = await evaluate(`
    const button = [...document.querySelectorAll('.composer button')].find((b) => /Dateien|Attach/i.test(b.getAttribute('aria-label') ?? b.title ?? ''))
    if (!button) return false
    button.click()
    return true
  `)
  await waitFor(`Boolean(document.querySelector('.composer-menu'))`, 4000, 'Plus-Menü öffnet sich').catch(() => null)
  const menuBox = await evaluate(`return (() => {
    const menu = document.querySelector('.composer-menu')
    if (!menu) return null
    const rect = menu.getBoundingClientRect()
    return {
      top: Math.round(rect.top), bottom: Math.round(rect.bottom),
      left: Math.round(rect.left), right: Math.round(rect.right),
      viewport: window.innerHeight,
      items: menu.querySelectorAll('[role="menuitem"]').length
    }
  })()`)
  check(
    'Plus-Menü bleibt vollständig im Fenster',
    menuBox && menuBox.top >= 0 && menuBox.bottom <= menuBox.viewport && menuBox.left >= 0 && menuBox.right <= menuBox.viewport,
    JSON.stringify({ plusFound, menuBox })
  )
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true`)
  await wait(300)
  check('Escape schließt das Plus-Menü', await evaluate(`return !document.querySelector('.composer-menu')`))

  // ------------------------------------------------------- Zugriffsstufen (Agent)
  // Die Stufe sitzt im Eingabebereich und ist nur im Agent-Modus sichtbar.
  await evaluate(`
    const agent = [...document.querySelectorAll('.segmented button')].find((b) => /Agent/.test(b.textContent))
    agent?.click()
    return true
  `)
  await wait(500)
  const permBefore = await evaluate(`return document.querySelector('.permission-trigger')?.textContent?.trim() ?? null`)
  check('Zugriffssteuer erscheint im Agent-Modus', permBefore === 'Manuell', permBefore)
  await evaluate(`document.querySelector('.permission-trigger')?.click(); return true`)
  await wait(350)
  const permItems = await evaluate(`return [...document.querySelectorAll('.composer-menu [role="menuitem"]')].map((n) => n.textContent.trim())`)
  check(
    'Drei Zugriffsstufen mit Erklärung',
    Array.isArray(permItems) && permItems.length === 3 && permItems.every((n) => n.length > 12),
    permItems
  )
  const permBox = await evaluate(`
    const box = document.querySelector('.composer-menu')?.getBoundingClientRect()
    return box ? { top: Math.round(box.top), bottom: Math.round(box.bottom), h: window.innerHeight } : null
  `)
  check('Zugriffsliste vollständig im Fenster', !!permBox && permBox.top >= 0 && permBox.bottom <= permBox.h, permBox)
  await evaluate(`
    const item = [...document.querySelectorAll('.composer-menu [role="menuitem"]')].find((n) => /Automatisch/.test(n.textContent))
    item?.click()
    return true
  `)
  await wait(500)
  check(
    'Stufe lässt sich umstellen',
    (await evaluate(`return document.querySelector('.permission-trigger')?.textContent?.trim()`)) === 'Automatisch'
  )
  // Sichere Stufe wiederherstellen, damit andere Prüfungen nicht umlernen
  await evaluate(`
    document.querySelector('.permission-trigger')?.click()
    return true
  `)
  await wait(300)
  await evaluate(`
    const item = [...document.querySelectorAll('.composer-menu [role="menuitem"]')].find((n) => /Manuell/.test(n.textContent))
    item?.click()
    return true
  `)
  await wait(400)
  await evaluate(`
    const chat = [...document.querySelectorAll('.segmented button')].find((b) => /^Chat$/.test(b.textContent.trim()))
    chat?.click()
    return true
  `)
  await wait(300)

  // ------------------------------------------------------------------ Geplant
  // Eigener, einmaliger Titel: so ist jede Prüfung an „ihren" Plan gebunden
  // und nicht an die Reihenfolge in der Liste.
  const planTitle = `Prüflauf ${Date.now()}`
  await evaluate(`return window.__h.dismissOverlays()`)
  await wait(200)
  await evaluate(`return window.__h.clickByText('.nav-item', 'Geplant')`)
  await wait(600)
  check('Geplant-Ansicht öffnet sich', (await evaluate(`return document.querySelector('.main h2')?.textContent`)) === 'Geplant')
  await evaluate(`return window.__h.clickByText('.main .btn', 'Zeitplan anlegen')`)
  await wait(400)
  check('Dialog zum Anlegen öffnet sich', await evaluate(`return Boolean(document.querySelector('#planned-title'))`))
  await evaluate(`return window.__h.type('#planned-title', ${JSON.stringify(planTitle)})`)
  await evaluate(`return window.__h.type('#planned-prompt', 'Antworte mit einem Wort.')`)
  await evaluate(`return window.__h.clickByText('.overlay .segmented button', 'In Abständen')`)
  await wait(300)
  await evaluate(`return window.__h.type('#planned-minutes', '30')`)
  await evaluate(`return window.__h.clickByText('.overlay .btn', 'Aufbewahren')`)
  await wait(700)

  // Alles Folgende wirkt nur auf den Plan mit diesem Titel.
  const scoped = (action) => `
    const items = [...document.querySelectorAll('.planned-item')]
    const item = items.find((n) => (n.querySelector('.planned-item__title')?.textContent ?? '').trim() === ${JSON.stringify(planTitle)})
    if (!item) return 'kein eigener Plan'
    const button = ${action}
    if (!button) return 'Knopf fehlt'
    button.click()
    return true
  `
  const ownText = `
    const items = [...document.querySelectorAll('.planned-item')]
    const item = items.find((n) => (n.querySelector('.planned-item__title')?.textContent ?? '').trim() === ${JSON.stringify(planTitle)})
    return item ? item.textContent.replace(/\\s+/g, ' ') : ''
  `

  const listed = await evaluate(ownText)
  check('Zeitplan erscheint in der Liste', typeof listed === 'string' && listed.includes(planTitle))
  check(
    'Zeitplan nennt Wiederholung und nächsten Lauf',
    /Alle 30 Minuten/.test(listed) && /Nächster Lauf/.test(listed),
    JSON.stringify(String(listed).slice(0, 140))
  )

  const pauseClicked = await evaluate(scoped(`item.querySelector('[title="Pausieren"]')`))
  await wait(700)
  const afterPause = await evaluate(ownText)
  check('Pausieren ist sichtbar', typeof afterPause === 'string' && afterPause.includes('pausiert'), `klick=${JSON.stringify(pauseClicked)} text=${JSON.stringify(String(afterPause).slice(0, 120))}`)
  await evaluate(scoped(`item.querySelector('[title="Wieder anlaufen lassen"]')`))
  await wait(700)
  check('Wieder anlaufen lassen ist sichtbar', !(await evaluate(ownText))?.includes('pausiert'))

  // Nur der eigene Plan verschwindet wieder; fremde bleiben unberührt.
  const otherBefore = await evaluate(`return document.querySelectorAll('.planned-item').length`)
  await evaluate(scoped(`item.querySelector('[title="Löschen"]')`))
  await wait(700)
  const plaeneDanach = await evaluate(`return document.querySelectorAll('.planned-item').length`)
  check('Zeitplan lässt sich löschen', plaeneDanach === otherBefore - 1, { vorher: otherBefore, nachher: plaeneDanach })

  // ------------------------------------------------------------------- Mobile
  await evaluate(`
    const item = [...document.querySelectorAll('.nav-item')].find((n) => /Remote/.test(n.textContent))
    item?.click()
    return true
  `)
  await wait(600)
  // Die Ansicht trägt jetzt eine Überschrift als Bühne, keinen Seitentitel.
  check('Die Gegenstelle zeigt auch einen Rechner', await evaluate(`
    const text = (document.querySelector('.dispatch__fine--zweit') || {}).textContent || ''
    return Boolean(document.querySelector('.phone') && document.querySelector('.rechner') && /Rechner/.test(text))
  `))
  // Im Browser gibt es den Ein-/Aus-Knopf absichtlich nicht (siehe unten).
  check('Remote-Ansicht öffnet sich', await evaluate(`return Boolean(document.querySelector('.main .dispatch__title') && (window.desk.fern || document.querySelector('.main .dispatch__button')))`))
  // Im Browser (Fernzugang) sitzt man auf genau diesem Zugang: dort nur
  // prüfen, dass die Seite das sagt, statt ihn umzuschalten.
  const imBrowser = await evaluate(`return Boolean(window.desk.fern)`)
  if (imBrowser) {
    const hinweis = await evaluate(`return document.querySelector('.main')?.textContent ?? ''`)
    check('Im Browser: Remote sagt, dass Umschalten nur am Rechner geht', /nur am Rechner/.test(hinweis), hinweis.slice(0, 80))
    check('Im Browser: kein Knopf zum Ausschalten', await evaluate(`return !document.querySelector('.main .dispatch__button')`))
  } else {
    // Der Zugang merkt sich, ob er an war, und kann schon laufen — dann erst aus,
    // damit der Klick unten wirklich das Einschalten prüft.
    await evaluate(`return (async () => {
      if ((await window.desk.mobile.status()).running) {
        await window.desk.mobile.stop()
        ;[...document.querySelectorAll('.nav-item')].find((n) => /Geplant/.test(n.textContent))?.click()
        await new Promise((r) => setTimeout(r, 300))
        ;[...document.querySelectorAll('.nav-item')].find((n) => /Remote/.test(n.textContent))?.click()
        await new Promise((r) => setTimeout(r, 500))
      }
      return true
    })()`)
    await evaluate(`document.querySelector('.main .dispatch__button')?.click(); return true`)
    await wait(1400)
    const mobileState = await evaluate(`return (async () => ({
      qr: Boolean(document.querySelector('.main img[src^="data:image/svg+xml"]')),
      address: document.querySelector('.main code')?.textContent ?? '',
      devices: (document.querySelector('.main')?.textContent ?? '').includes('Angemeldete Geräte'),
      gemerkt: (await window.desk.settings.get()).fernzugangAn,
      neuerCode: [...document.querySelectorAll('.main button')].some((b) => /Neuen Code erzeugen/.test(b.textContent))
    }))()`)
    check('Der Zugang merkt sich, dass er an ist (MacBook bleibt nach Neustart drin)', mobileState?.gemerkt === true, JSON.stringify(mobileState))
    check('Ein neuer Code lässt sich erzeugen', mobileState?.neuerCode === true)
    // Kopieren in die Zwischenablage: scheiterte in der installierten App mit
    // „Write permission denied“. Jetzt über den Hauptprozess.
    const kopiert = await evaluate(`return (async () => {
      const knopf = [...document.querySelectorAll('.main button')].find((b) => /Adresse kopieren/.test(b.textContent))
      const fehlerVorher = document.querySelectorAll('.fehlerbruecke').length
      knopf?.click()
      await new Promise((r) => setTimeout(r, 600))
      return { knopf: Boolean(knopf), bestaetigt: /Kopiert/.test(knopf?.textContent ?? ''), fehler: document.querySelectorAll('.fehlerbruecke').length - fehlerVorher, erwartet: (await window.desk.mobile.status()).url, fokus: document.hasFocus() }
    })()`)
    // Die System-Zwischenablage selbst wird nicht verglichen: Solange jemand am
    // Rechner arbeitet, liegt dort, was er gerade kopiert hat (so geschehen).
    check(
      '„Adresse kopieren“ kopiert ohne Fehler und bestätigt es',
      kopiert?.knopf && kopiert?.bestaetigt && kopiert?.fehler === 0,
      JSON.stringify(kopiert)
    )
    check('Remote schaltet ein und zeigt den Code', mobileState?.qr && /^(http:\/\/\d+\.\d+\.\d+\.\d+:\d+|https:\/\/[\w.-]+\.ts\.net(:\d+)?)$/.test(mobileState?.address ?? ''), JSON.stringify(mobileState))

    // Die angezeigte Adresse ist ohne Zugangsstand — der steckt nur im Code.
    // (Ein echter Abruf von hier wäre wertlos: Die Inhaltsrichtlinie des Fensters
    // lässt keine Verbindungen ins Netz zu. Die Zugriffskontrolle selbst prüfen
    // die Einzelnachweise des Zugangs.)
    const shownAddress = await evaluate(`return document.querySelector('.main code')?.textContent ?? ''`)
    check('Sichtbare Adresse enthält keinen Zugangsstand', !shownAddress.includes('token'), shownAddress)

    // Und wieder ausschalten, damit kein horchender Dienst im Test bleibt
    await evaluate(`document.querySelector('.main .dispatch__button')?.click(); return true`)
    await wait(900)
    check('Remote schaltet wieder aus', await evaluate(`return !document.querySelector('.main img[src^="data:image/svg+xml"]')`))
  }

  // Die tiefere Recherche sitzt im Plus-Menü des Eingabefeldes.
  {
    const neuKnopf = await evaluate(`
      const knopf = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Neu')
      if (knopf) knopf.click()
      return !!knopf
    `)
    await waitFor(`!!document.querySelector('.composer__input')`, 8000)
    await evaluate(`
      const knopf = [...document.querySelectorAll('.composer button')].find(b => /Dateien|hinzuf/i.test(b.title || ''))
      if (knopf) knopf.click()
      return !!knopf
    `)
    await waitFor(`!!document.querySelector('.composer-menu')`, 6000)
    const punkte = await evaluate(`
      return [...document.querySelectorAll('.composer-menu button')].map(b => b.textContent.trim()).join(' | ')
    `)
    const geklickt = await evaluate(`
      const ziel = [...document.querySelectorAll('.composer-menu button')].find(b => /Recherche/.test(b.textContent))
      if (ziel) ziel.click()
      return !!ziel
    `)
    await waitFor(`((document.querySelector('.composer__input') || {}).value || '').indexOf('Recherchiere') === 0`, 6000)
    const text = await evaluate(`return (document.querySelector('.composer__input') || {}).value || ''`)
    check('Das Plus-Menü bietet die tiefere Recherche an', /Recherche/.test(String(punkte)) && String(text).startsWith('Recherchiere'), `${punkte} — ${String(text).slice(0, 40)} | Neu-Knopf: ${neuKnopf} | Klick: ${geklickt}`)
    await evaluate(`
      const feld = document.querySelector('.composer__input')
      if (feld) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        setter.call(feld, '')
        feld.dispatchEvent(new Event('input', { bubbles: true }))
      }
      return true
    `)
  }

  // Die Stufe ist auch dort schaltbar, wo sie dasteht — ohne Umweg über das
  // Menü. Und der Klick darf das Menü nicht öffnen.
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true`)
  await wait(300)
  const schalten = await evaluate(`
    const knopf = document.querySelector('.pill__note--schaltbar')
    if (!knopf) return { übersprungen: 'kein denkendes Modell gewählt' }
    const vorher = knopf.textContent.trim()
    knopf.click()
    await new Promise((loes) => setTimeout(loes, 320))
    const liste = document.querySelector('.stufenliste')
    const punkte = liste ? [...liste.querySelectorAll('.stufenliste__punkt')] : []
    // Eine Stufe wählen, die es in der Liste gibt — und nicht die aktuelle.
    const ziel = punkte.find((p) => p.querySelector('.stufenliste__name').textContent.trim() !== vorher)
    ziel?.click()
    await new Promise((loes) => setTimeout(loes, 350))
    const nachher = document.querySelector('.pill__note--schaltbar')?.textContent.trim()
    const menueOffen = Boolean(document.querySelector('.modellmenue'))
    // Die Prüfung danach darf nicht die Stufe vorfinden, die diese hier
    // weitergeschaltet hat — also der gespeicherte Stand zurück, exakt so, wie
    // er war (auch „gar keine eigene Stufe" ist ein Zustand).
    const grund = await window.desk.settings.get()
    // Der Bezug ist der Modellverweis, nicht der Titel der Pille.
    const bezug = grund.defaultModelChat ?? ''
    const eigene = (grund.reasoning || {})[bezug]
    const stufe = JSON.parse(JSON.stringify(grund.reasoning || {}))
    if (eigene === undefined) delete stufe[bezug]
    else stufe[bezug] = eigene
    await window.desk.settings.set({ reasoning: stufe })
    return { vorher, nachher, stufen: punkte.length, listenWeg: !document.querySelector('.stufenliste'), menueOffen }
  `)
  check(
    'Die Denkstufe schaltet an ihrer Anzeige um',
    schalten?.übersprungen
      ? true
      : Boolean(schalten?.vorher) && schalten.stufen >= 5 && schalten.vorher !== schalten.nachher && schalten.listenWeg && schalten.menueOffen === false,
    JSON.stringify(schalten)
  )

  // Das Mikrofon sitzt rechts neben der Modellauswahl und die Rückmeldung
  // verdrängt nichts: sie liegt über dem Feld, nicht im Satz.
  const sitzung = await evaluate(`
    const knopf = document.querySelector('.mic-btn')
    const pille = document.querySelector('.pill')
    const leiste = document.querySelector('.composer__bar')
    if (!knopf || !pille || !leiste) return { fehlend: true }
    return {
      rechtsVomModell: knopf.getBoundingClientRect().left > pille.getBoundingClientRect().left,
      höhe: Math.round(leiste.getBoundingClientRect().height)
    }
  `)
  // Über http gibt ein Browser das Mikrofon nicht frei — dort fehlt es absichtlich.
  const ohneMikrofon = await evaluate(`return Boolean(window.desk.fern && !window.isSecureContext)`)
  if (ohneMikrofon) check('Im Browser ohne https: kein Mikrofon, das nicht ginge', sitzung?.fehlend === true)
  else check('Das Mikrofon sitzt rechts neben der Modellauswahl', sitzung?.rechtsVomModell === true, JSON.stringify(sitzung))

  // Jede Seite der Seitenleiste muß etwas zeigen: leere Fläche ist ein Fehler,
  // auch wenn nichts kracht.
  const seiten = await evaluate(`return (async () => {
    const worte = ['Neu', 'Projekte', 'Artifacts', 'Geplant', 'Remote', 'Anpassen', 'New', 'Projects', 'Scheduled']
    const haupt = document.querySelector('.haupt') || document.querySelector('main') || document.body
    const fund = []
    for (const wort of worte) {
      const knopf = [...document.querySelectorAll('.nav-item, .sidefoot button, .sidebar button')].find((n) => n.textContent.trim().startsWith(wort))
      if (!knopf) { fund.push({ wort, knopf: false }); continue }
      knopf.click()
      await new Promise((loes) => setTimeout(loes, 450))
      fund.push({ wort, knopf: true, zeichen: (haupt.innerText || '').trim().length })
    }
    return fund
  })()`)
  const leer = (seiten ?? []).filter((seite) => seite.knopf && seite.zeichen < 12)
  check('Keine Seite der Seitenleiste bleibt leer', leer.length === 0, JSON.stringify({ leer, seiten: (seiten ?? []).map((s) => `${s.wort}:${s.zeichen ?? '-'}`) }))

  // ------------------------------------------------------------- Layoutstabilität
  // Ein Rundgang durch die Oberflächen: Text, der über seine Kachel läuft,
  // Kästen, die aus dem Fenster wachsen, und Knöpfe, die übereinander rutschen.
  const layoutPrüfung = async (bereich) => {
    const funde = await evaluate(`return (() => {
      const probleme = []
      const sichtbar = (el) => {
        const stil = getComputedStyle(el)
        if (stil.display === 'none' || stil.visibility === 'hidden' || Number(stil.opacity) === 0) return false
        const mess = el.getBoundingClientRect()
        return mess.width > 1 && mess.height > 1
      }
      // Die Schriftstufe ist hier Zoom: bei 80 % wird die Rechenfläche breiter,
      // als das Fenster meldet — das ist die Rechnung, kein Überlaufen. Also
      // gegen die Fläche vergleichen, die dem Inhalt bei dieser Stufe zusteht.
      const stufe = Number(getComputedStyle(document.documentElement).zoom) || 1
      const rahmen = window.innerWidth / stufe
      if (document.body.scrollWidth > rahmen + 1) {
        probleme.push({ art: 'horizontaler Überlauf', pixel: Math.round(document.body.scrollWidth - rahmen), stufe })
      }
      const alle = [...document.querySelectorAll('body *')].filter(sichtbar)
      for (const el of alle) {
        const r = el.getBoundingClientRect()
        const ausdemRoll = (() => {
          for (let a = el.parentElement; a; a = a.parentElement) {
            const stil = getComputedStyle(a)
            if (/(auto|scroll|hidden|clip)/.test(stil.overflowX + stil.overflowY)) return true
          }
          return false
        })()
        if (!ausdemRoll && (r.right > window.innerWidth + 2 || r.left < -2 || r.bottom > window.innerHeight + 2)) {
          probleme.push({ art: 'aus dem Fenster', knoten: el.tagName + '.' + String(el.className).slice(0, 32), box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] })
        }
        if (el.children.length === 0 && (el.textContent || '').trim()) {
          if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).textOverflow !== 'ellipsis') {
            probleme.push({ art: 'Text abgeschnitten', text: el.textContent.trim().slice(0, 30), knoten: String(el.className).slice(0, 32) })
          }
        }
      }
      // Wird ein Bedienelement tatsächlich verdeckt? Die Geometrie allein sagt
      // zu wenig: eine durchsichtige Fläche darf über etwas liegen, solange sie
      // den Klick nicht abfängt. Getestet wird deshalb der echte Treffer.
      const bedienbar = alle.filter((el) => (/^(BUTTON|A|SELECT|INPUT|TEXTAREA)$/.test(el.tagName) || el.getAttribute('role') === 'button') && !el.disabled)
      // Ein Element, das aus seinem Rollbereich herausgescrollt ist, hat seine
      // Mitte neben dem Bereich — das ist kein Überlappen, das ist Normalbetrieb.
      const ausgerollt = (el) => {
        const r = el.getBoundingClientRect()
        for (let a = el.parentElement; a; a = a.parentElement) {
          const stil = getComputedStyle(a)
          if (!/(auto|scroll|hidden|clip)/.test(stil.overflowY + stil.overflowX)) continue
          const k = a.getBoundingClientRect()
          if (r.top < k.top - 1 || r.bottom > k.bottom + 1 || r.left < k.left - 1 || r.right > k.right + 1) return false
        }
        return true
      }
      // Ein offener Dialog verdeckt den Rest absichtlich — dann zählt nur, was
      // in ihm liegt. Alles andere wäre ein Befund über den Zweck von Dialogen.
      const dialog = [...document.querySelectorAll('.overlay')].pop()
      const imBlick = dialog ? bedienbar.filter((el) => dialog.contains(el)) : bedienbar
      for (const el of imBlick.filter(ausgerollt)) {
        const r = el.getBoundingClientRect()
        const treffer = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
        if (!treffer) continue
        if (treffer === el || el.contains(treffer) || treffer.contains(el)) continue
        probleme.push({
          art: 'verdeckt',
          knoten: String(el.className).slice(0, 26) || el.tagName,
          durch: treffer.tagName + '.' + String(treffer.className).slice(0, 26)
        })
      }
      return { anzahl: alle.length, probleme: probleme.slice(0, 12) }
    })()`)
    check(`Layout hält: ${bereich}`, (funde?.probleme?.length ?? 0) === 0, JSON.stringify({ bereich, ...funde }))
  }

  await layoutPrüfung('Start')
  await evaluate(`document.querySelector('.pill')?.click(); return true`)
  await wait(350)
  await layoutPrüfung('Modellmenü offen')
  for (const [name, text] of [['Aufwand', /Aufwand|Effort/], ['Weitere Modelle', /Weitere Modelle|More models/]]) {
    await evaluate(`[...document.querySelectorAll('.modellmenue__zeile')].find((n) => ${text}.test(n.textContent))?.click(); return true`)
    await wait(300)
    await layoutPrüfung(`Modellmenü: ${name} aufgeklappt`)
  }
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true`)
  await wait(250)
  await evaluate(`window.desk && appStoreSetSettings?.(); return true`).catch(() => null)
  await layoutPrüfung('Einrichtung')

  // Modelle im Eingabefeld: in den Einstellungen angehakt, genau die im Menü.
  const auswahl = await evaluate(`return (async () => {
    const w = (ms) => new Promise((r) => setTimeout(r, ms))
    const vorher = (await window.desk.settings.get()).modellauswahl ?? []
    // Das offene Gespräch merken: die Prüfungen danach erwarten es wieder.
    const vorherGespraech = [...document.querySelectorAll('.chat-row')].findIndex((z) => z.dataset.active === 'true')
    // Von einem ruhigen Stand aus: Menüs zu, Startseite, dann die Einstellungen.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await w(200)
    await window.__h.dismissOverlays()
    ;[...document.querySelectorAll('button, div[role=button]')].find((x) => x.textContent.trim() === 'Neu')?.click(); await w(500)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true })); await w(500)
    ;[...document.querySelectorAll('.einstellungen button')].find((b) => /Modelle und Anbieter/.test(b.textContent))?.click(); await w(500)
    const boxen = () => [...document.querySelectorAll('.modellwahl-liste__eintrag input')]
    const alle = boxen().length
    for (const b of boxen().filter((b) => b.checked)) { b.click(); await w(200) }
    boxen()[0]?.click(); await w(300); boxen()[1]?.click(); await w(400)
    const gewaehlt = [...document.querySelectorAll('.modellwahl-liste__eintrag[data-an] .modellwahl-liste__name')].map((n) => n.textContent)
    // Bis fünf — das sechste Häkchen ist gesperrt.
    for (const b of boxen().filter((b) => !b.checked).slice(0, 4)) { b.click(); await w(250) }
    const gesperrt = boxen().filter((b) => b.disabled).length
    const zaehler = document.querySelector('.modellwahl-liste .zahl')?.textContent
    for (const b of boxen().filter((b) => b.checked).slice(2)) { b.click(); await w(250) }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await w(400)
    const pille = [...document.querySelectorAll('.pill')].find((n) => n.offsetParent)
    const aktuell = pille?.textContent ?? ''
    pille?.click(); await w(500)
    const imMenue = [...document.querySelectorAll('.modellmenue > .modellmenue__modell .modellmenue__name')].map((n) => n.textContent)
    const aendern = [...document.querySelectorAll('.modellmenue__zeile')].find((n) => /Auswahl ändern/.test(n.textContent))
    aendern?.click(); await w(600)
    const springt = Boolean(document.querySelector('.modellwahl-liste'))
    // Zurück auf den alten Stand — über die Oberfläche, damit sie ihn auch kennt.
    for (const b of boxen().filter((b) => b.checked)) { b.click(); await w(200) }
    await window.desk.settings.set({ modellauswahl: vorher })
    await window.__h.dismissOverlays()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await w(200)
    if (vorherGespraech >= 0) { document.querySelectorAll('.chat-row')[vorherGespraech]?.click(); await w(600) }
    return { alle, gewaehlt, imMenue, aktuell, gesperrt, zaehler, springt }
  })()`)
  check('Modelle im Eingabefeld: genau die angehakten stehen im Menü', (auswahl?.alle ?? 0) > 5 && auswahl?.gewaehlt?.length === 2 && JSON.stringify(auswahl.imMenue.filter((m) => auswahl.gewaehlt.includes(m) || !auswahl.aktuell.includes(m))) === JSON.stringify(auswahl.gewaehlt), JSON.stringify(auswahl))
  check('Höchstens fünf Modelle — das sechste Häkchen ist gesperrt', auswahl?.zaehler === '5 von 5' && auswahl?.gesperrt === (auswahl?.alle ?? 0) - 5, JSON.stringify({ zaehler: auswahl?.zaehler, gesperrt: auswahl?.gesperrt }))
  check('„Auswahl ändern …“ führt direkt zur Modellauswahl', auswahl?.springt === true)

  // --------------------------------------------------- jede Einstellung einzeln
  // Jede Einstellung wird wirklich durch die Leitung geschickt und zurückgeholt.
  // Prüfen in der Hauptseite genügt nicht: es gab ein Feld, das brav gemerkt,
  // aber nie angewendet wurde.
  const umlauf = await evaluate(`return (async () => {
    const grund = await window.desk.settings.get()
    const fehl = []
    const alternativen = { language: ['de', 'en'], theme: ['light', 'dark', 'system'], startView: ['home', 'lastChat'], composerMode: ['chat', 'agent'], effort: ['auto', 'off', 'low', 'medium', 'high'] }
    for (const [feld, wert] of Object.entries(grund)) {
      if (wert === null || wert === undefined || typeof wert === 'object') continue
      let neuwert
      // Freitext und Verweise bleiben draußen: ein erdachter Modellverweis
      // macht die Einrichtung kaputt, die die Prüfungen danach brauchen. Was
      // hier durch muß, ist die Klasse „gemerkt, aber nie angewendet" — und das
      // sind Schalter, Zahlen und Aufzählungen.
      if (typeof wert === 'boolean') neuwert = !wert
      else if (alternativen[feld]) neuwert = alternativen[feld].find((k) => k !== wert)
      else if (feld === 'panelWidth') neuwert = 700
      else if (feld === 'schriftstufe') neuwert = 110
      else continue
      const gesetzt = await window.desk.settings.set({ [feld]: neuwert })
      if (gesetzt?.[feld] !== neuwert) fehl.push({ feld, gesendet: neuwert, zurueck: gesetzt?.[feld] })
      await window.desk.settings.set({ [feld]: wert })
    }
    const ende = await window.desk.settings.get()
    const unveraendert = Object.entries(grund).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(ende[k])).map(([k]) => k)
    return { fehl, unveraendert, felder: Object.keys(grund).length }
  })()`)
  check('Jede Einstellung übersteht den Umlauf', (umlauf?.fehl?.length ?? 1) === 0, JSON.stringify(umlauf))
  check('Nach dem Umlauf steht wieder die alte Einrichtung', (umlauf?.unveraendert?.length ?? 1) === 0, JSON.stringify(umlauf?.unveraendert))

  const abgelehnt = await evaluate(`return (async () => {
    try {
      await window.desk.settings.set({ theme: 'giftig' })
      return { abgelehnt: false }
    } catch {
      return { abgelehnt: true }
    }
  })()`)
  check('Ein ungültiger Einrichtungswert wird abgelehnt, nicht geschluckt', abgelehnt?.abgelehnt === true, JSON.stringify(abgelehnt))

  // Ein abgewiesener Aufruf darf nicht kommentarlos verpuffen.
  const fänger = await evaluate(`return (async () => {
    Promise.reject(new Error('Erdfall-Prüfung'))
    await new Promise((loes) => setTimeout(loes, 400))
    const feld = document.querySelector('.fehlerbruecke')
    const text = feld?.textContent ?? ''
    feld?.querySelector('.fehlerbruecke__zu')?.click()
    await new Promise((loes) => setTimeout(loes, 250))
    return { gezeigt: text.includes('Erdfall-Prüfung'), weg: !document.querySelector('.fehlerbruecke') }
  })()`)
  check('Ein abgewiesener Aufruf wird gezeigt und verschwindet auf Zuruf', fänger?.gezeigt === true && fänger?.weg === true, JSON.stringify(fänger))

  // Der Schalter muß auch **im Gespräch** da sein — nicht nur auf der Startseite.
  // Er war an zwei Bedingungen geknüpft (Modell in der Liste und meldet
  // Denkfähigkeit); fehlte eine, verschwand er spurlos und die Stufe war nur
  // noch in den Einstellungen zu erreichen.
  const imGespraech = await evaluate(`return (async () => {
    await window.__h.dismissOverlays()
    document.querySelector('.chat-row')?.click()
    await new Promise((loes) => setTimeout(loes, 900))
    const notiz = document.querySelector('.pill__note--schaltbar')
    if (!notiz) return { schalter: false, pille: document.querySelector('.pill')?.textContent ?? null, ueberlagert: Boolean(document.querySelector('.overlay')), zeilen: document.querySelectorAll('.chat-row').length, ansicht: document.querySelector('.main')?.firstElementChild?.className, text: (document.querySelector('.main')?.innerText ?? '').slice(0, 160), zeile: document.querySelector('.chat-row')?.textContent }
    notiz.click()
    await new Promise((loes) => setTimeout(loes, 400))
    const punkte = [...document.querySelectorAll('.stufenliste__punkt')]
    const vorher = notiz.textContent.trim()
    const ziel = punkte.find((k) => k.querySelector('.stufenliste__name').textContent.trim() !== vorher)
    ziel?.click()
    await new Promise((loes) => setTimeout(loes, 500))
    const stand = await window.desk.settings.get()
    document.querySelector('.stufenliste__punkt')?.click()
    return {
      schalter: true,
      stufen: punkte.length,
      gewechselt: document.querySelector('.pill__note')?.textContent?.trim() !== vorher,
      gemerkt: Object.keys(stand.reasoning).length
    }
  })()`)
  check('Im Gespräch ist die Denkstufe schaltbar', imGespraech?.schalter === true && imGespraech.stufen >= 5 && imGespraech.gewechselt === true, JSON.stringify(imGespraech))

  // ------------------------------------------------------- Größenmatrix
  // Dasselbe Rundgang durch andere Breiten und Schriftstufen. Electrons
  // Fernsteuerung kennt die Fensterdomäne nicht; was das Layout angeht, tut die
  // Seiten-Emulation genau dasselbe: sie setzt die_viewport_-Maße, nach denen
  // alles gerechnet wird. 980 Pixel sind kein Wunschdenken, sondern ein
  // Notebook mit aufgerissener Seitenleiste.
  const matrix = [
    { breite: 980, hoehe: 720, stufe: 100 },
    { breite: 1180, hoehe: 700, stufe: 130 },
    { breite: 1560, hoehe: 860, stufe: 80 }
  ]
  for (const feld of matrix) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: feld.breite, height: feld.hoehe, deviceScaleFactor: 1, mobile: false })
    await evaluate(`document.documentElement.style.zoom = '${(feld.stufe / 100).toFixed(2)}'; return true`)
    await wait(450)
    await layoutPrüfung(`${feld.breite} px, Schrift ${feld.stufe}`)
  }
  await evaluate(`document.documentElement.style.zoom = '1'; return true`)
  await cdp.send('Emulation.clearDeviceMetricsOverride')
  await wait(300)

  // ------------------------------------------------------- Gespräch: Frage und Zeichen
  // Die eigene Frage stand nie im Verlauf (nur die Antwort), und das Zeichen
  // saß starr oben links statt unter der Antwort mitzulaufen.
  const verlauf = await evaluate(`return (async () => {
    await window.__h.dismissOverlays()
    const zeilen = [...document.querySelectorAll('.chat-row')]
    for (const zeile of zeilen) {
      zeile.click()
      await new Promise((loes) => setTimeout(loes, 350))
      if (document.querySelector('.msg-assistant') && document.querySelector('.msg-user')) break
    }
    const fragen = document.querySelectorAll('.msg-user').length
    const antwort = [...document.querySelectorAll('.msg-assistant')].pop()
    const zeichen = antwort?.querySelector('.msg-assistant__mark')
    const koerper = antwort?.querySelector('.msg-body')
    const z = zeichen?.getBoundingClientRect(), k = koerper?.getBoundingClientRect()
    return {
      fragen,
      // Links neben dem Text, außerhalb davon — auf Höhe der letzten Textzeile.
      zeichenLinks: Boolean(z && k && z.right <= k.left),
      zeichenUnten: z && k ? Math.round(k.bottom - z.bottom) : null,
      zeichenJe: document.querySelectorAll('.msg-assistant__mark').length
    }
  })()`)
  check('Die eigene Frage steht im Verlauf', (verlauf?.fragen ?? 0) > 0, JSON.stringify(verlauf))
  check('Das Zeichen steht links neben der letzten Zeile der jüngsten Antwort, nur dort', verlauf?.zeichenLinks === true && Math.abs(verlauf?.zeichenUnten ?? 99) <= 2 && verlauf?.zeichenJe === 1, JSON.stringify(verlauf))

  // ------------------------------------------------------------------- Skills
  const skills = await evaluate(`return (async () => {
    const knopf = [...document.querySelectorAll('.nav-item, .sidebar button')].find((n) => n.textContent.trim().startsWith('Anpassen'))
    knopf?.click()
    await new Promise((loes) => setTimeout(loes, 500))
    const titel = document.querySelector('.skills__titel')?.textContent
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Hinzufügen'))?.click()
    await new Promise((loes) => setTimeout(loes, 250))
    const menue = [...document.querySelectorAll('.skills__menue strong')].map((n) => n.textContent)
    ;[...document.querySelectorAll('.skills__menue button')].find((b) => b.textContent.includes('Skill anlegen'))?.click()
    await new Promise((loes) => setTimeout(loes, 300))
    window.__h.type('.skills__editor input', 'Prüf Skill')
    await new Promise((loes) => setTimeout(loes, 80))
    const name = document.querySelector('.skills__editor input')?.value
    const felder = document.querySelectorAll('.skills__editor textarea')
    const setze = (feld, wert) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(feld, wert); feld.dispatchEvent(new Event('input', { bubbles: true })) }
    setze(felder[0], 'Für die Prüfung.')
    setze(felder[1], 'Nichts tun.')
    await new Promise((loes) => setTimeout(loes, 80))
    ;[...document.querySelectorAll('.skills__editor button')].find((b) => b.textContent.trim() === 'Speichern')?.click()
    await new Promise((loes) => setTimeout(loes, 700))
    const zeile = [...document.querySelectorAll('.skills__zeile')].find((z) => z.textContent.includes('pruef-skill') || z.textContent.includes('prüf-skill'))
    const gespeichert = (await window.desk.skills.list()).map((s) => s.name)
    return { titel, menue, name, zeile: Boolean(zeile), gespeichert }
  })()`)
  check('Anpassen zeigt die Skills mit Anlegen und Übernehmen', skills?.titel === 'Skills' && skills?.menue?.length === 2, JSON.stringify(skills))
  check('Ein Skill-Name wird in die erlaubte Form gebracht', skills?.name === 'prüf-skill', skills?.name)
  // Umlaute sind im Namen nicht erlaubt (SKILL.md-Format) — der Editor sagt es, statt still zu scheitern.
  const skillHinweis = await evaluate(`return document.querySelector('.skills__editor .msg-error')?.textContent ?? null`)
  check('Ein ungültiger Skill-Name wird am Feld erklärt', typeof skillHinweis === 'string' && skillHinweis.includes('Kleinbuchstaben'), skillHinweis)
  await evaluate(`return (async () => {
    window.__h.type('.skills__editor input', 'pruef-skill')
    await new Promise((loes) => setTimeout(loes, 80))
    ;[...document.querySelectorAll('.skills__editor button')].find((b) => b.textContent.trim() === 'Speichern')?.click()
    await new Promise((loes) => setTimeout(loes, 700))
    return true
  })()`)
  const skillDa = await evaluate(`return (await window.desk.skills.list()).some((s) => s.name === 'pruef-skill')`)
  check('Ein angelegter Skill steht in der Liste', skillDa === true, skillDa)

  // Die Skills-Seite und ihr Editor in derselben Größenmatrix wie oben.
  await evaluate(`return (async () => {
    ;[...document.querySelectorAll('.skills__text')].find((b) => b.textContent.includes('pruef-skill'))?.click()
    await new Promise((loes) => setTimeout(loes, 300))
    return true
  })()`)
  for (const feld of matrix) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: feld.breite, height: feld.hoehe, deviceScaleFactor: 1, mobile: false })
    await evaluate(`document.documentElement.style.zoom = '${(feld.stufe / 100).toFixed(2)}'; return true`)
    await wait(400)
    await layoutPrüfung(`Skills-Editor ${feld.breite} px, Schrift ${feld.stufe}`)
  }
  await evaluate(`document.documentElement.style.zoom = '1'; return true`)
  await cdp.send('Emulation.clearDeviceMetricsOverride')
  await evaluate(`return (async () => { await window.__h.dismissOverlays(); await window.desk.skills.remove('pruef-skill'); return true })()`)
  await wait(300)

  await shot('ende')

  // --------------------------------------------------------------------- Protokoll
  const ignored = (text) =>
    text.includes('Download the React DevTools') || text.includes('ResizeObserver') || text.includes('favicon')
  const realConsole = [...new Set(consoleErrors.filter((e) => !ignored(e)))]
  if (realConsole.length) console.log('\nKonsolenfehler:\n' + realConsole.slice(0, 10).map((e) => '  • ' + e.slice(0, 260)).join('\n'))
  if (pageErrors.length) console.log('\nUnbehandelte Ausnahmen:\n' + [...new Set(pageErrors)].slice(0, 10).map((e) => '  • ' + e.slice(0, 260)).join('\n'))

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} Prüfungen bestanden`)
  if (failed.length) {
    console.log('Fehlstellen:')
    for (const f of failed) console.log('  · ' + f.name + (f.detail ? ` — ${String(f.detail).slice(0, 200)}` : ''))
  }
  cdp.close()
  process.exit(failed.length > 0 ? 1 : 0)

    JSON.stringify(schalten)
}

main().catch((e) => {
  console.error('Abbruch:', e.message)
  process.exit(2)
})

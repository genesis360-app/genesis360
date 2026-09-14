---
name: plan_audio_videos
description: Plan de audio y diseño sonoro para los videos de Genesis360 — brief original, qué se aceptó, qué se desafió con mediciones, y el pipeline reutilizable.
type: manual
updated: 2026-09-14
---

# Plan de audio de los videos

Pedido de GO (2026-09-14): que la gente, al ver y escuchar el video, **quiera comprar el producto**.
El audio tiene que reforzar lo que la pantalla ya muestra.

Este documento es el acuerdo de trabajo: qué se hace, por qué, y qué se descartó **con la medición
al lado**. El brief original vino de un productor de sonido; acá está lo que se tomó y lo que se
discutió.

> ⚠️ **Claude no escucha.** Genera, mide (LUFS, pico real, energía por banda) y produce variantes.
> **Todo juicio estético es de quien escucha.** El flujo siempre es: generar A/B → decide GO.

---

## 1. Lo que se acepta del brief, sin discusión

| Indicación | Por qué se acepta |
|---|---|
| **Tempo 98-105 BPM** | Rango correcto para "optimista sin apuro". Se usa **100**. |
| **Re Mayor (D)** | Tonalidad brillante y abierta. En cuerdas resuena por las cuerdas al aire; en síntesis igual funciona por registro. |
| **Estructura I-IV → I-V-vi-IV → Dsus4→D** | Progresión pop probada. La suspensión que resuelve **en el logo** es un recurso real de cierre. |
| **Hueco en 2.5-4 kHz atado a la voz** | Es la indicación **más profesional del brief** (ver la salvedad en §2.3). |
| **Evitar hipercompresión** | Correcto. Se entrega con rango dinámico y `TP -1.5 dBTP`. |
| **Aire en 10-12 kHz** | Legítimo para percepción *premium*. |

---

## 2. Lo que se desafía — con números

### 2.1 A = 432 Hz no hace lo que el brief promete

El brief lo pide "para una percepción más orgánica, suave y menos agresiva al oído". **Eso no tiene
respaldo**: es un mito de audio bastante extendido; a doble ciego no aparece una diferencia
atribuible a la referencia de afinación. Lo que sí es real es el **costo**: el día que entre una
pista licenciada, un jingle o cualquier sample a 440, van a batir desafinados.

**Pero acá el costo es cero**, porque se sintetiza todo desde cero y no hay nada con qué desafinar.

**Resolución**: queda como parámetro (`afinacion`), y se generaron **dos muestras idénticas** —
`a-440` y `b-432`— para decidir con el oído en vez de discutir. Si GO escucha una diferencia que le
gusta, se usa 432 y listo; es una preferencia estética legítima, solo que no por el motivo que da
el brief.

### 2.2 El `-18 LUFS` estaba mal planteado para nuestro caso

LUFS mide el **programa completo**; no se setea "por debajo de la voz". Y sobre todo: **los videos
de hoy no tienen voz en off**, así que la música *es* el programa.

Dos masters distintos, no uno:

| Destino | Objetivo | Por qué |
|---|---|---|
| **`sinVoz`** (hoy) | **−14 LUFS** integrado | Es a lo que normaliza YouTube. Si se entrega más bajo, **YouTube no lo sube**: el video suena flojo contra todo lo demás. |
| **`conVoz`** (cuando haya narración) | **−26 LUFS** integrado | El lecho queda ~12 LU debajo de la voz, que es donde se apoya sin tapar. |

Ambos con **pico real −1.5 dBTP** para que ningún códec de plataforma genere distorsión.

Verificado en las muestras con `loudnorm` de dos pasadas: −13,5 / −14,0 / −13,6 / −13,8 LUFS.

### 2.3 El hueco para la voz: correcto como técnica, casi cosmético en ESTA cama

Primero, un error propio que vale documentar: se intentó cavar el pocket **dentro del
sintetizador** con filtros de un polo. **No funcionaba**: 0,4 dB de cavado real, contra los ~8 dB
que el comentario afirmaba. Un polo tiene faldas de 6 dB/oct — demasiado suave para abrir un hueco.

Corregido: va en la **cadena de master**, con un biquad de verdad:

```
equalizer=f=3250:width_type=o:width=0.9:g=-9     → 4,3 dB reales en la banda aislada
```

**Y ahora el hallazgo que importa.** Medido sobre la cama actual:

> La banda 2.5-4 kHz está **36 dB por debajo** del total de la mezcla.

O sea: **casi no hay energía ahí**. Los pads viven abajo y el arpegio (D5-A5) apenas roza esa zona.
El consejo del brief es correcto, pero está pensado para una mezcla **densa** — cuerdas, piano
brillante, batería. Sobre esta cama, cavar el pocket es casi cosmético.

Se deja en el master igual (no molesta, y protege si la cama se vuelve más densa), pero **no hay que
esperar que arregle nada de inteligibilidad hoy**.

⚠️ **Trampa de medición, para no repetirla:** `bandpass` de ffmpeg es de 2 polos y deja pasar los
graves, que están 25 dB más arriba y **tapan la lectura**. Medido así, el pocket "no existía". Para
medir una banda hay que aislarla en serio — 4 polos por falda:

```
highpass=f=2500:poles=2,highpass=f=2500:poles=2,lowpass=f=4000:poles=2,lowpass=f=4000:poles=2
```

---

## 3. Lo que el brief no ve, y es donde más se gana

### 3.1 Diseño de sonido, no solo música

El brief se llama "diseño de sonido" pero es **100% música**. En un demo de producto, lo que más
convence no es la melodía: es **escuchar que el producto responde**.

- un clic suave al apretar un botón,
- un *chime* corto cuando el negocio se crea,
- otro cuando el producto se guarda,
- uno de resolución cuando **la caja cierra y cuadra**.

Eso es lo que hace que un software se sienta vivo y sólido. Es la diferencia entre "mirar un video de
una app" y "sentir que la estoy usando".

**Estado**: pendiente de construir. Es el próximo paso después de que GO elija la cama.

### 3.2 🔑 Sincronía con el guion — la ventaja que el brief no podía conocer

Los videos se generan con `guion.json`, que tiene los **timestamps exactos** de cada momento clave.
La música no tiene que "acompañar": puede **resolver justo ahí**.

Momentos ya identificados en la serie:

| Video | Momento | Segundo (del recorte) |
|---|---|---|
| 1 | "tu negocio queda creado" | al aterrizar el dashboard |
| 3 | producto guardado | al volver a la lista |
| 5 | **"Sin diferencia"** al cerrar la caja | en el modal de cierre |

Implementado como `acentos: [seg, seg]` en el spec: un brillo corto (D5-A5-D6, ataque de 5 ms) que
marca el momento sin interrumpir. Muestra `c-acentos`. 🛑 **GO lo rechazó** al escucharlo: *"distraen, no suman"* — ver §4.bis.

Con una pista comprada esto **no se puede hacer**.

### 3.3 Duración adaptativa

Los videos van de 50 a 79 s y cada uno dura distinto. Una pista fija looppeada siempre corta mal. El
sintetizador **arma el arreglo sobre la duración real**: intro fija, cuerpo que se estira, y la
resolución `Dsus4 → D` **siempre cae sobre la placa de cierre**.

### 3.4 Silencio y contraste

Una cama pared a pared cansa. Vale bajar el pulso justo antes del momento clave para que la
resolución golpee. Pendiente de probar cuando GO elija la base.

### 3.5 Los primeros 3 segundos

Es donde se decide si alguien sigue mirando. Hoy la intro entra con un fundido de 2,5 s — puede ser
demasiado tímido. A probar contra una entrada más directa.

---

## 4. El pipeline

```
scripts/video/musica.mjs   ← sintetizador (spec JSON → WAV)
scripts/video/postproducir.mjs ← placas, rótulos y mezcla final
scripts/video/overlay.html ← plantilla visual de los rótulos
```

### Spec de música

```json
{
  "duracion": 59, "bpm": 100, "afinacion": 432,
  "intro": 8, "outro": 7,
  "arpegio": true, "pulsoRitmico": true,
  "destino": "sinVoz",
  "acentos": []
}
```

### Cadena de master

```bash
# sin voz (hoy)
ffmpeg -i cama.wav -af "loudnorm=I=-14:TP=-1.5:LRA=11" salida.wav

# con voz (cuando exista narración)
ffmpeg -i cama.wav -af "equalizer=f=3250:width_type=o:width=0.9:g=-9,loudnorm=I=-26:TP=-1.5:LRA=11" salida.wav
```

### Cómo suena hoy — decisiones técnicas del sintetizador

- **ADSR real** por nota: un ataque de 0 ms es lo que hace que un tono sintetizado suene a alarma.
- **Armónicos** (1 · 0,45 · 0,22 · 0,1) en vez de senos puros.
- **Detune de 3 cents** en tres voces: da coro y calidez; sin él, dos senos suman y suena a sirena.
- **Reverb Schroeder** (4 peines + 2 pasa-todo) para el "aire premium".
- **Estéreo leve por Haas** (12 ms solo en el canal derecho) y **graves al centro**, porque la
  mayoría mira en el celular.

---

## 4.bis Decisiones tomadas por GO (2026-09-14, escuchando)

| Pregunta | Veredicto | Aplicado |
|---|---|---|
| Afinación: 440 vs **432** | **432** — a GO le gustó más | `afinacion: 432` es el default |
| Densidad: con arpegio+pulso vs solo pads | **Está bien como cama de fondo** — la densidad actual sirve, no hace falta más presencia | se mantiene arpegio + pulso |
| Acentos sincronizados al guion | 🛑 **"distraen, no suman"** — rechazado | `acentos: []`. La capacidad queda en el código por si cambia el criterio, pero **no se usa** |

Sobre los acentos vale registrar el aprendizaje: era **mi propuesta** y técnicamente funcionaba
(marcar el momento exacto del guion). Pero un brillo cada vez que pasa algo **compite con la
pantalla** en lugar de reforzarla. La lección: sincronizar no es gratis — lo que suma es que la
**estructura** caiga bien, no que cada evento tenga su sonidito.

## 4.ter 🛑 El bug de la frase cortada (encontrado por GO, de oído)

GO escuchando la muestra de 30 s: *"al segundo 23 como que corta la melodía que venía haciendo y
parece que pasa al outro"*. **Tenía razón, y era un bug de arreglo, no una cuestión de gusto.**

Las secciones se cortaban por **tiempo**, no por **frase**:

```
30 s · 100 BPM → compás = 2,4 s
cuerpo de 8 a 23 s = 6,25 compases
progresión D–A–Bm–G (4 acordes)
→ a los 23 s la secuencia venía en **Bm**, el tercero, y el outro le caía encima
```

**Corregido**: ahora se calcula cuántos **ciclos completos** de 4 acordes entran, y el cierre arranca
recién cuando la progresión terminó en **G (IV)** — que además es la mejor antesala posible para el
`Dsus4 → D`.

Y el último compás hace un **gesto de cierre** de verdad:
- el arpegio **baja** en vez de subir,
- el pulso **se calla** (ese silencio es lo que anuncia el final),
- el acorde se sostiene casi el doble y **se solapa** con la resolución, así no queda hueco.

**Cómo se verifica sin escuchar**: `construir.ultimaAgenda` devuelve la agenda de acordes con sus
segundos. El cuerpo **siempre** tiene que terminar en `G` antes del `Dsus4`:

```
30 s → 0 D · 2.4 G · 4.8 D · 7.2 D · 9.6 A · 12 Bm · 14.4 G · 16.8 Dsus4 · 23.4 D
59 s → … 43.2 G · 45.6 Dsus4 · 52.3 D
```

> **Lección que vale más que el fix**: un oído detectó en 30 segundos algo que ninguna medición mía
> iba a encontrar. LUFS, pico y espectro estaban perfectos — el problema era **musical**. Cuando no
> se puede escuchar, hay que hacer que lo audible sea **verificable de otra forma** (acá, la agenda
> de acordes), y aun así el oído humano sigue siendo el juez.

## 4.quater ✅ Aplicado a toda la serie (2026-09-14)

GO: *"Sigamos con la propia que está buena"* → el sintetizador queda como la fuente de música de los
videos. `postproducir.mjs` ahora importa `musica.mjs` (antes generaba senos con ffmpeg, que sonaban
a pitido plano).

**Los 5 videos re-renderizados.** Y al medirlos apareció algo que no era el objetivo del cambio:

| | Antes | Ahora |
|---|---|---|
| Loudness | **−29,8 LUFS** | **−13,3 a −13,7 LUFS** |

Los renders viejos estaban **16 dB por debajo** del objetivo. YouTube no sube lo que recibe bajo, así
que habrían sonado anémicos contra cualquier otro video. **No era solo la melodía: el audio venía
mal nivelado.** Los renders anteriores quedaron en `_anteriores/` por si hace falta comparar.

## 4.quinquies 🔉 La música bajó 10 dB — GO: "está saturando" (2026-09-14)

Escuchando la serie terminada, GO pidió bajar la música **"por lo menos un 50%"** porque satura.
Medido: los finales están a −13,6 LUFS con un **LRA de apenas 3,2-3,6 LU** — una cama muy densa y
pareja, empujada al nivel de programa. El −14 de §2 era correcto *en papel* (es a lo que normaliza
YouTube), pero en un video sin voz, donde la música acompaña pantallas que hay que leer, queda encima.

**Decisión: master de la música a −24 LUFS (−10 dB).** Se eligió −10 y no −6 porque "la mitad" de
volumen *percibido* son unos 10 dB; −6 dB es la mitad de *amplitud*, que al oído queda bastante más
fuerte que la mitad. −10 cubre las dos lecturas de "50%".

⚠️ **Consecuencia aceptada**: YouTube no sube lo que está por debajo de −14, así que estos videos van
a sonar más bajos que otros. Es lo pedido: la música acompaña, no protagoniza. **Esto supera el
razonamiento de −14 de §2.**

- Es el **default de `postproducir.mjs`** desde ahora; se puede pisar por guion con `audio.lufs`.
- Aplica a los **próximos** videos. Los 5 hechos siguen a −14 hasta que GO decida re-renderizarlos
  (son minutos: no hay que volver a grabar, solo correr `postproducir.mjs` sobre el crudo).
- Junto con esto GO pidió **efectos visuales en los clicks** (el cursor no se ve): ver
  [Efectos de click](guion-videos-onboarding.md#-efectos-de-click-para-los-próximos-videos-pedido-de-go-2026-09-14).
  El "pop" sonoro que los acompañe entra acá como diseño de sonido — y a este volumen nuevo.

---

## 4.sexies 🔊 Efectos sonoros de los clicks — primera versión (2026-09-14)

Con los efectos de click (ver el [guion](guion-videos-onboarding.md)) entró la primera pieza del **diseño de
sonido** de §3.1, sintetizada en `efectos.mjs`, sincronizada con cada sticker:

- *pop* con caída de tono (1.140 → 320 Hz, ~0,16 s) en cada sticker;
- **campanitas de caja registradora** (2.093 + 2.637 Hz) en el cobro;
- **golpe grave** (100 → 55 Hz) cuando la imagen se sacude.

Nivel: **pico −12 dBFS**. A −18 quedaban tapados — medido restando la versión sin efectos: en el cobro el pico de
la ventana subía 0,9 dB; a −12 sube 3,8 dB. El programa completo queda en −23,4 LUFS: los efectos no mueven el
integrado.

🟡 **A validar por GO de oído**: el Video 4 salió en dos versiones (con y sin sonido de efectos). Se desactivan
por guion con `"efectos": { "sonido": false }`.

---

## 5. Qué falta decidir (GO)

1. ✅ Afinación — **432**, decidido.
2. ✅ Densidad — **cama de fondo**, decidido.
3. ✅ Acentos — **rechazados**, decidido.
4. ✅ **Síntesis propia** — decidido ("está buena"). Queda como fuente de música de la serie.

**Lo único que sigue pendiente** es el **diseño de sonido** de §3.1 (que se escuche que el producto
responde: clic, chime al guardar, resolución cuando la caja cuadra). Es el próximo paso de audio.

Sobre la 4, honestamente: **la síntesis propia tiene techo**. Llega a "corporativo correcto", no a
"premium con instrumentos reales". Si el objetivo es que el video *venda*, puede convenir **licenciar
una pista buena** y que este pipeline se ocupe de lo que sí hace bien: **sincronizarla al guion,
cavar el pocket, masterizar a los dos objetivos y sumar el diseño de sonido**. Eso combina lo mejor
de los dos lados.

---

## Relacionado

- [Guion de los videos de onboarding](guion-videos-onboarding.md)
- `scripts/video/` — el pipeline completo
- Los videos producidos viven en `D:/Dev/genesis360-videos/` (fuera del repo: son binarios)

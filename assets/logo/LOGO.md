# z0gcode — Logo assets (opción 1b "Zero Slash")

Terminal coding agent sobre la red 0G. El símbolo es un cero barrado
(el glifo `0` de las fuentes monospace): el círculo es el **0 de 0G**
y la barra diagonal violeta es la **Z de Zog**. Dos marcas en una.

## Colores

| Token        | Hex       | Uso                                      |
|--------------|-----------|------------------------------------------|
| Ink          | `#08090C` | Fondo terminal / app                     |
| Surface      | `#14151D` | Fondo de favicon / tarjetas              |
| Foam (texto) | `#F2F1EC` | Círculo del 0, wordmark en fondo oscuro  |
| Violet 0G    | `#A78BFF` | Barra diagonal, el `0` del wordmark, acentos |
| Violet deep  | `#7C4DFF` | Acento en fondo claro                    |
| Ink light    | `#17141F` | Círculo y texto en fondo claro           |
| Muted        | `#6B7080` | Texto secundario en terminal             |

## Tipografía

Wordmark: **JetBrains Mono Medium**, minúsculas: `z0gcode` — se escribe
con cero, y ese `0` va siempre en violeta.
Fallback: `ui-monospace, monospace`.

## Archivos

- `z0gcode-mark-dark.svg` / `z0gcode-mark-light.svg` — símbolo, viewBox 96×96
- `z0gcode-lockup-dark.svg` / `z0gcode-lockup-light.svg` — símbolo + wordmark
- `z0gcode-icon.svg` — app icon 512×512, fondo violeta, trazo tinta
- `favicon.svg` — favicon 32×32, fondo tinta

Nota: los lockups usan `<text>` con JetBrains Mono; carga la fuente o
convierte el texto a trazados si necesitas un SVG 100 % autocontenido.

## Splash ASCII (banner de terminal)

Sin color (el 0 central lleva la barra `/`):

```
█████   ███    ████
   ██  █  /█  █
  ██   █ / █  █  ██   z0gcode v1.0
 ██    █/  █  █   █   on 0G network
█████   ███    ████
```

Con ANSI: el `0` barrado completo (círculo + barra) va en violeta,
el resto en blanco roto. Ejemplo en JS (sin dependencias):

```js
const V = "\x1b[38;2;167;139;255m"; // violeta 0G
const W = "\x1b[38;2;242;241;236m"; // foam
const M = "\x1b[90m";               // muted
const R = "\x1b[0m";

console.log(`
${W}█████   ${V}███${W}    ████${R}
${W}   ██  ${V}█  /█${W}  █${R}
${W}  ██   ${V}█ / █${W}  █  ██${R}   ${M}z0gcode v1.0${R}
${W} ██    ${V}█/  █${W}  █   █${R}   ${M}on 0G network${R}
${W}█████   ${V}███${W}    ████${R}
`);
```

Prompt sugerido: `z0g $` con el `0` en violeta y cursor de bloque parpadeante.

## Reglas de uso

- La barra siempre va de abajo-izquierda a arriba-derecha (como el
  cero barrado tipográfico). No invertirla ni rotarla.
- Espacio de seguridad: 20 % del ancho del símbolo por cada lado.
- Tamaño mínimo del símbolo: 16 px.
- En fondos claros usar la variante *light* (`#17141F` + `#7C4DFF`).
- En el wordmark, escribir siempre `z0gcode` (con cero), nunca "z0gcode"
  cuando acompaña al símbolo.

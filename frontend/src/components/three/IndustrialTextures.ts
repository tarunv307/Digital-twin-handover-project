import * as THREE from "three";

interface TextureBundle {
  concreteMap: THREE.CanvasTexture;
  concreteRoughnessMap: THREE.CanvasTexture;
  claddingMap: THREE.CanvasTexture;
  siloConcreteMap: THREE.CanvasTexture;
  asphaltMap: THREE.CanvasTexture;
}

let cachedBundle: TextureBundle | null = null;

function makeRepeatingTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  repeatX: number,
  repeatY: number,
  srgb = true
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    draw(ctx, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function getIndustrialTextures(): TextureBundle {
  if (cachedBundle) return cachedBundle;

  // Polished concrete epoxy shop-floor diffuse map with expansion joint lines
  const concreteMap = makeRepeatingTexture(
    512,
    (ctx, s) => {
      ctx.fillStyle = "#dce5ef";
      ctx.fillRect(0, 0, s, s);

      // Subtle trowel / aggregate variation
      for (let i = 0; i < 1600; i += 1) {
        const x = ((i * 73) % s);
        const y = ((i * 137) % s);
        const v = 210 + ((i * 19) % 24);
        ctx.fillStyle = `rgba(${v}, ${v + 5}, ${v + 12}, 0.28)`;
        ctx.fillRect(x, y, 3 + (i % 4), 2 + (i % 3));
      }

      // Slab control joints
      ctx.strokeStyle = "rgba(130, 148, 170, 0.45)";
      ctx.lineWidth = 2;
      for (let p = 0; p < s; p += 128) {
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, s);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, p);
        ctx.lineTo(s, p);
        ctx.stroke();
      }
    },
    10,
    7,
    true
  );

  // Polished concrete subtle roughness variation for realistic sheen
  const concreteRoughnessMap = makeRepeatingTexture(
    256,
    (ctx, s) => {
      ctx.fillStyle = "#7a7a7a";
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 900; i += 1) {
        const x = (i * 59) % s;
        const y = (i * 97) % s;
        const g = 90 + ((i * 23) % 55);
        ctx.fillStyle = `rgb(${g}, ${g}, ${g})`;
        ctx.fillRect(x, y, 8, 8);
      }
    },
    8,
    6,
    false
  );

  // Corrugated steel cladding for exterior hall walls and roof panels
  const claddingMap = makeRepeatingTexture(
    256,
    (ctx, s) => {
      ctx.fillStyle = "#cfd8e3";
      ctx.fillRect(0, 0, s, s);
      for (let x = 0; x < s; x += 16) {
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.fillRect(x, 0, 5, s);
        ctx.fillStyle = "rgba(100,116,139,0.22)";
        ctx.fillRect(x + 6, 0, 4, s);
        ctx.fillStyle = "rgba(71,85,105,0.12)";
        ctx.fillRect(x + 12, 0, 2, s);
      }
      // Subtle horizontal panel seam
      ctx.strokeStyle = "rgba(71,85,105,0.22)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, s / 2);
      ctx.lineTo(s, s / 2);
      ctx.stroke();
    },
    14,
    2,
    true
  );

  // Weathered slip-form concrete for industrial silos and preheater towers
  const siloConcreteMap = makeRepeatingTexture(
    256,
    (ctx, s) => {
      ctx.fillStyle = "#bfc7cf";
      ctx.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += 32) {
        ctx.fillStyle = y % 64 === 0 ? "rgba(148,163,184,0.22)" : "rgba(255,255,255,0.12)";
        ctx.fillRect(0, y, s, 16);
        ctx.fillStyle = "rgba(71,85,105,0.22)";
        ctx.fillRect(0, y + 30, s, 2);
      }
      for (let i = 0; i < 650; i += 1) {
        const x = (i * 83) % s;
        const y = (i * 41) % s;
        ctx.fillStyle = "rgba(75,85,99,0.14)";
        ctx.fillRect(x, y, 2, 6);
      }
    },
    3,
    4,
    true
  );

  // Industrial asphalt road surface
  const asphaltMap = makeRepeatingTexture(
    256,
    (ctx, s) => {
      ctx.fillStyle = "#4b5563";
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 1400; i += 1) {
        const x = (i * 47) % s;
        const y = (i * 89) % s;
        const shade = 64 + ((i * 13) % 36);
        ctx.fillStyle = `rgb(${shade}, ${shade + 4}, ${shade + 8})`;
        ctx.fillRect(x, y, 2, 2);
      }
    },
    12,
    4,
    true
  );

  cachedBundle = {
    concreteMap,
    concreteRoughnessMap,
    claddingMap,
    siloConcreteMap,
    asphaltMap,
  };
  return cachedBundle;
}

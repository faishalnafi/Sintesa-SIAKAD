import React, { useEffect, useRef } from "react";

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseVx: number;
  baseVy: number;
  freeSpeed: number; // Base speed during freedom
  radius: number;
  isLarge: boolean;
  baseAlpha: number;
  twinkleSpeed: number; // Random blinking speed (ultra-slow to super-fast)
  twinklePhase: number;
  orbitDirection: number; // 1 (clockwise) or -1 (counter-clockwise)
  ellipseA: number; // Semi-major axis of ellipse (42px - 102px)
  ellipseB: number; // Semi-minor axis of ellipse (18px - 65px)
  ellipseTilt: number; // Angle of ellipse rotation/inclination in radians [0, 2PI]
  orbitAngle: number; // Parametric angle along ellipse [0, 2PI]
  currentOrbitRadius: number; // Current distance from orbit center
  isOrbiting: boolean; // Currently locked into an elliptical orbit
  escapeCooldown: number; // Cooldown frames after escaping before being captured again
  isBurst: boolean;
  burstDecay: number;
  currentAge: number; // Current accumulated age in ms
  baseLifespan: number; // Visible lifespan in ms (30,000ms - 45,000ms)
  fadeDuration: number; // Fade out duration in ms (2,000ms)
}

const INITIAL_PARTICLES = 50; // Initial dot count: 50
const STAR_ORBIT_RADIUS = 90; // Capture threshold for star clusters
const CURSOR_ORBIT_RADIUS = 115; // Capture threshold around cursor
const BOUNDARY_MARGIN = 90; // Allow particles to travel outside canvas before wrapping

// SSO Vibrant Blue: rgb(15, 145, 252) / #0F91FC
// Pure White: rgb(255, 255, 255) / #FFFFFF
function getParticleRGB(x: number, splitX: number): { r: number; g: number; b: number } {
  const transitionWidth = 60;
  const t = Math.max(0, Math.min(1, (x - (splitX - transitionWidth / 2)) / transitionWidth));

  const r = Math.round(15 + (255 - 15) * t);
  const g = Math.round(145 + (255 - 145) * t);
  const b = Math.round(252 + (255 - 252) * t);

  return { r, g, b };
}

function getLineStroke(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  splitX: number,
  alpha: number
): string | CanvasGradient {
  const c1 = getParticleRGB(x1, splitX);
  const c2 = getParticleRGB(x2, splitX);

  if (Math.abs(c1.r - c2.r) < 8 && Math.abs(c1.g - c2.g) < 8) {
    return `rgba(${c1.r}, ${c1.g}, ${c1.b}, ${alpha})`;
  }

  const grad = ctx.createLinearGradient(x1, y1, x2, y2);
  grad.addColorStop(0, `rgba(${c1.r}, ${c1.g}, ${c1.b}, ${alpha})`);
  grad.addColorStop(1, `rgba(${c2.r}, ${c2.g}, ${c2.b}, ${alpha})`);
  return grad;
}

export const ParticleCanvas: React.FC<{ className?: string }> = ({ className = "" }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let particles: Particle[] = [];
    let nextId = 1;
    let width = 0;
    let height = 0;
    let dpr = window.devicePixelRatio || 1;

    // Population control state hysteresis
    let isPendingDeath = false; // Triggered if <= 25 dots until count reaches 50
    let isAcceleratedDeath = false; // Triggered if > 250 dots until count drops to <= 100

    // Mouse coordinates relative to canvas
    let mouse: { x: number; y: number } | null = null;

    const createParticle = (
      x?: number,
      y?: number,
      isBurst = false,
      burstVx = 0,
      burstVy = 0,
      initialAge = 0
    ): Particle => {
      // FULL RANDOM SIZE SPECTRUM (Large, Medium, Small) for BOTH Natural & Burst Stars
      const sizeRand = Math.random();
      let isLarge = false;
      let radius: number;

      if (sizeRand < 0.22) {
        // Large Glowing Star (~22%): 3.8px - 6.0px (Radiant Halo Aura)
        isLarge = true;
        radius = Math.random() * 2.2 + 3.8;
      } else if (sizeRand < 0.60) {
        // Medium Radiant Star (~38%): 2.4px - 3.7px
        radius = Math.random() * 1.3 + 2.4;
      } else {
        // Small Sparkling Dot (~40%): 1.2px - 2.3px
        radius = Math.random() * 1.1 + 1.2;
      }

      // DYNAMIC & CONTRASTIVE RANDOM SPEEDS (Fast, Medium, Slow)
      const speedRand = Math.random();
      let speedMagnitude: number;
      if (isLarge) {
        speedMagnitude = Math.random() * 0.5 + 0.6; // Large stars: 0.60 - 1.10 px/frame
      } else if (speedRand < 0.28) {
        speedMagnitude = Math.random() * 2.0 + 3.2; // 28% Hyper-Fast dots: 3.20 - 5.20 px/frame (zips across!)
      } else if (speedRand < 0.55) {
        speedMagnitude = Math.random() * 1.2 + 2.0; // 27% Fast energetic dots: 2.00 - 3.20 px/frame
      } else if (speedRand < 0.82) {
        speedMagnitude = Math.random() * 0.9 + 1.1; // 27% Medium cruising dots: 1.10 - 2.00 px/frame
      } else {
        speedMagnitude = Math.random() * 0.5 + 0.45; // 18% Slow relaxed dots: 0.45 - 0.95 px/frame
      }

      const angle = Math.random() * Math.PI * 2;
      const baseVx = Math.cos(angle) * speedMagnitude;
      const baseVy = Math.sin(angle) * speedMagnitude;
      const freeSpeed = Math.hypot(baseVx, baseVy);

      // TWINKLE SPEED SPECTRUM: ULTRA-SLOW TO VERY FAST
      const twinkleRand = Math.random();
      let twinkleSpeed: number;
      if (twinkleRand < 0.25) {
        twinkleSpeed = Math.random() * 0.10 + 0.12; // 25% Sangat Cepat (Rapid diamond sparkle: 2-4 blinks/sec)
      } else if (twinkleRand < 0.50) {
        twinkleSpeed = Math.random() * 0.05 + 0.06; // 25% Cepat (Brisk pulse: ~1 blink/sec)
      } else if (twinkleRand < 0.75) {
        twinkleSpeed = Math.random() * 0.025 + 0.025; // 25% Sedang (Smooth rhythmic shimmer: 2-3s per cycle)
      } else {
        twinkleSpeed = Math.random() * 0.009 + 0.004; // 25% Sangat Lamban (Deep slow celestial breathing: 8-15s per cycle)
      }

      const twinklePhase = Math.random() * Math.PI * 2;

      const id = nextId++;

      // Unique Ellipse Geometry per particle
      const ellipseA = 42 + (id % 5) * 12 + Math.random() * 16; // 42px - 102px
      const eccentricity = 0.45 + Math.random() * 0.38; // 0.45 - 0.83
      const ellipseB = Math.max(18, ellipseA * Math.sqrt(1 - eccentricity * eccentricity)); // 18px - 65px
      const ellipseTilt = Math.random() * Math.PI * 2;

      // Lifespan: 30s to 45s (30,000ms - 45,000ms) + 2s fade-out transition
      const baseLifespan = (30 + Math.floor(Math.random() * 16)) * 1000; // Exact 30s up to 45s
      const fadeDuration = 2000; // 2 seconds fade-out transition

      return {
        id,
        x: x ?? Math.random() * (width || window.innerWidth || 800),
        y: y ?? Math.random() * (height || window.innerHeight || 600),
        vx: isBurst ? burstVx : baseVx,
        vy: isBurst ? burstVy : baseVy,
        baseVx,
        baseVy,
        freeSpeed,
        radius,
        isLarge,
        baseAlpha: isLarge ? 1.0 : 1.0,
        twinkleSpeed,
        twinklePhase,
        orbitDirection: Math.random() < 0.5 ? 1 : -1,
        ellipseA,
        ellipseB,
        ellipseTilt,
        orbitAngle: Math.random() * Math.PI * 2,
        currentOrbitRadius: ellipseA,
        isOrbiting: false,
        escapeCooldown: 0,
        isBurst,
        burstDecay: 1.0,
        currentAge: initialAge,
        baseLifespan,
        fadeDuration,
      };
    };

    // Initialize initial 50 dots with staggered ages across 0-28s so they expire naturally over time
    const initParticles = () => {
      particles = [];
      for (let i = 0; i < INITIAL_PARTICLES; i++) {
        const initialAge = Math.random() * 28000;
        particles.push(createParticle(undefined, undefined, false, 0, 0, initialAge));
      }
    };

    const handleResize = () => {
      if (!container || !canvas) return;
      const rect = container.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = window.devicePixelRatio || 1;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.scale(dpr, dpr);

      if (particles.length === 0) {
        initParticles();
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    handleResize();

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      if ("touches" in e) {
        if (e.touches.length > 0) {
          mouse = {
            x: e.touches[0].clientX - rect.left,
            y: e.touches[0].clientY - rect.top,
          };
        }
      } else {
        mouse = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
      }
    };

    const handlePointerLeave = () => {
      mouse = null;
    };

    // Click handler: Spawns exactly 10 stars with randomized size (large to small) and radial burst
    const handleClick = (e: MouseEvent | TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      let clickX = width / 2;
      let clickY = height / 2;

      if ("touches" in e) {
        if (e.touches.length > 0) {
          clickX = e.touches[0].clientX - rect.left;
          clickY = e.touches[0].clientY - rect.top;
        }
      } else {
        clickX = e.clientX - rect.left;
        clickY = e.clientY - rect.top;
      }

      // Add 10 particles thrown away from cursor with varied sizes from large to small
      for (let i = 0; i < 10; i++) {
        const angle = (Math.PI * 2 * i) / 10 + (Math.random() - 0.5) * 0.6;
        const burstPower = Math.random() * 4.0 + 5.0; // Fast energetic burst (5.0 - 9.0 px/frame)
        const burstVx = Math.cos(angle) * burstPower;
        const burstVy = Math.sin(angle) * burstPower;

        particles.push(createParticle(clickX, clickY, true, burstVx, burstVy, 0));
      }
    };

    canvas.addEventListener("mousemove", handlePointerMove);
    canvas.addEventListener("mouseleave", handlePointerLeave);
    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("touchmove", handlePointerMove, { passive: true });
    canvas.addEventListener("touchstart", handleClick, { passive: true });
    canvas.addEventListener("touchend", handlePointerLeave);

    // Periodic Spawning Timer: Every 60 seconds, add 5 new dots with smooth 2s fade-in
    const periodicSpawnInterval = setInterval(() => {
      for (let i = 0; i < 5; i++) {
        particles.push(createParticle(undefined, undefined, false, 0, 0, 0));
      }
    }, 60000);

    let frameCount = 0;
    let lastFrameTime = performance.now();

    const getMass = (p: Particle) => (p.isLarge ? p.radius * p.radius * 4 : p.radius * p.radius);

    // Draw organic constellation lines within elliptical orbit systems
    const drawOrbitConstellationWeb = (
      centerX: number,
      centerY: number,
      radius: number,
      splitX: number,
      isCursorCenter = false
    ) => {
      const cluster: { p: Particle; dist: number }[] = [];
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (Math.abs(p.x - centerX) < 0.01 && Math.abs(p.y - centerY) < 0.01) continue;

        const dist = Math.hypot(p.x - centerX, p.y - centerY);
        if (dist <= radius && p.isOrbiting) {
          cluster.push({ p, dist });
        }
      }

      if (cluster.length === 0) return;

      // 1. Spoke lines: Orbit Center <-> Orbiting Dot
      for (const item of cluster) {
        const lineAlpha = (1 - item.dist / radius) * (isCursorCenter ? 0.60 : 0.52);
        if (lineAlpha > 0.02) {
          const stroke = getLineStroke(ctx, centerX, centerY, item.p.x, item.p.y, splitX, lineAlpha);
          ctx.beginPath();
          ctx.moveTo(centerX, centerY);
          ctx.lineTo(item.p.x, item.p.y);
          ctx.strokeStyle = stroke;
          ctx.lineWidth = isCursorCenter ? 0.90 : 0.75;
          ctx.stroke();
        }
      }

      // 2. Inter-dot lines when two orbiting dots pass nearby
      for (let i = 0; i < cluster.length; i++) {
        for (let j = i + 1; j < cluster.length; j++) {
          const p1 = cluster[i].p;
          const p2 = cluster[j].p;
          const distBetween = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          const maxMeshDist = isCursorCenter ? 65 : 55;

          if (distBetween < maxMeshDist) {
            const alphaRatio =
              (1 - distBetween / maxMeshDist) *
              (1 - Math.max(cluster[i].dist, cluster[j].dist) / (radius + 15)) *
              (isCursorCenter ? 0.55 : 0.45);

            if (alphaRatio > 0.02) {
              const stroke = getLineStroke(ctx, p1.x, p1.y, p2.x, p2.y, splitX, alphaRatio);
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.strokeStyle = stroke;
              ctx.lineWidth = 0.7;
              ctx.stroke();
            }
          }
        }
      }
    };

    // Main animation loop
    const render = () => {
      frameCount++;
      const now = performance.now();
      const deltaMs = Math.min(100, now - lastFrameTime);
      lastFrameTime = now;

      ctx.clearRect(0, 0, width, height);

      // --- POPULATION HYSTERESIS LOGIC ---
      if (particles.length <= 25) {
        isPendingDeath = true;
      } else if (particles.length >= 50) {
        isPendingDeath = false;
      }

      if (particles.length > 250) {
        isAcceleratedDeath = true;
      } else if (particles.length <= 100) {
        isAcceleratedDeath = false;
      }

      let ageMultiplier = 1.0;
      if (isPendingDeath) {
        ageMultiplier = 0.0;
      } else if (isAcceleratedDeath) {
        ageMultiplier = 4.0;
      }

      for (let i = 0; i < particles.length; i++) {
        particles[i].currentAge += deltaMs * ageMultiplier;
      }

      if (!isPendingDeath) {
        particles = particles.filter((p) => p.currentAge < p.baseLifespan + p.fadeDuration);
      }

      if (particles.length < INITIAL_PARTICLES) {
        particles.push(createParticle(undefined, undefined, false, 0, 0, 0));
      }

      const splitX = width >= 1024 ? width / 2 : width;
      const largeParticles = particles.filter((p) => p.isLarge);

      // 1. Update Physics: Keplerian Elliptical Orbits with Dynamic Lively Speeds
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        if (p.escapeCooldown > 0) {
          p.escapeCooldown--;
        }

        if (p.isBurst) {
          p.isOrbiting = false;
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= 0.95;
          p.vy *= 0.95;
          p.burstDecay *= 0.96;

          if (Math.hypot(p.vx, p.vy) < 1.0) {
            p.isBurst = false;
            p.vx = p.baseVx;
            p.vy = p.baseVy;
          }
        } else {
          let orbitCenterX = 0;
          let orbitCenterY = 0;
          let maxOrbitRadius = 0;
          let hasCenter = false;
          let isCursorOrbit = false;

          // Only capture if not currently in escape cooldown
          if (p.escapeCooldown === 0) {
            if (mouse) {
              const distToMouse = Math.hypot(p.x - mouse.x, p.y - mouse.y);
              if (distToMouse < CURSOR_ORBIT_RADIUS) {
                orbitCenterX = mouse.x;
                orbitCenterY = mouse.y;
                maxOrbitRadius = CURSOR_ORBIT_RADIUS;
                hasCenter = true;
                isCursorOrbit = true;
              }
            }

            if (!hasCenter && !p.isLarge) {
              let closestLarge: Particle | null = null;
              let minDistance = Infinity;

              for (const lp of largeParticles) {
                const dist = Math.hypot(p.x - lp.x, p.y - lp.y);
                if (dist < minDistance) {
                  minDistance = dist;
                  closestLarge = lp;
                }
              }

              if (closestLarge && minDistance < STAR_ORBIT_RADIUS) {
                orbitCenterX = closestLarge.x;
                orbitCenterY = closestLarge.y;
                maxOrbitRadius = STAR_ORBIT_RADIUS;
                hasCenter = true;
                isCursorOrbit = false;
              }
            }
          }

          if (hasCenter) {
            if (!p.isOrbiting) {
              p.isOrbiting = true;
              p.orbitAngle = Math.atan2(p.y - orbitCenterY, p.x - orbitCenterX) - p.ellipseTilt;
            }

            const breathing = Math.sin(frameCount * 0.035 + p.id) * 3.0;
            const a = Math.min(p.ellipseA + breathing, maxOrbitRadius);
            const b = Math.min(p.ellipseB + breathing * 0.6, a * 0.85);

            const localX = a * Math.cos(p.orbitAngle);
            const localY = b * Math.sin(p.orbitAngle);
            const r = Math.hypot(localX, localY);
            p.currentOrbitRadius = r;

            // Keplerian Speed Variation
            const proximity = Math.max(0, a - r);
            const speedMultiplier = (1.0 + 0.02 * proximity) * Math.pow(a / Math.max(16, r), 0.4);
            const linearSpeed = p.freeSpeed * speedMultiplier;

            // Angular velocity along ellipse
            const angularVelocity = ((linearSpeed * 1.6) / Math.max(16, r)) * p.orbitDirection;
            p.orbitAngle = (p.orbitAngle + angularVelocity) % (Math.PI * 2);

            const cosTilt = Math.cos(p.ellipseTilt);
            const sinTilt = Math.sin(p.ellipseTilt);
            const idealTargetX = orbitCenterX + (localX * cosTilt - localY * sinTilt);
            const idealTargetY = orbitCenterY + (localX * sinTilt + localY * cosTilt);

            const unrotatedVx = -a * Math.sin(p.orbitAngle) * angularVelocity;
            const unrotatedVy = b * Math.cos(p.orbitAngle) * angularVelocity;
            const tangentVx = unrotatedVx * cosTilt - unrotatedVy * sinTilt;
            const tangentVy = unrotatedVx * sinTilt + unrotatedVy * cosTilt;

            // BREAKOUT / ESCAPE LOGIC:
            const isNearApoapsis = Math.abs(Math.cos(p.orbitAngle)) > 0.88;
            const isBeyondThreshold = r > (isCursorOrbit ? 98 : 78);

            if (isNearApoapsis && (isBeyondThreshold || Math.random() < 0.003)) {
              p.isOrbiting = false;
              p.escapeCooldown = 100;
              p.vx = tangentVx * 1.35;
              p.vy = tangentVy * 1.35;
              const currentSpeed = Math.hypot(p.vx, p.vy);
              if (currentSpeed > 0.1) {
                p.baseVx = (p.vx / currentSpeed) * p.freeSpeed;
                p.baseVy = (p.vy / currentSpeed) * p.freeSpeed;
              }
            } else {
              const followElasticity = isCursorOrbit ? 0.15 : 0.18;
              const idealVx = (idealTargetX - p.x) * 0.45;
              const idealVy = (idealTargetY - p.y) * 0.45;

              p.vx = p.vx * 0.82 + idealVx * followElasticity;
              p.vy = p.vy * 0.82 + idealVy * followElasticity;

              p.x += p.vx;
              p.y += p.vy;
            }
          } else {
            p.isOrbiting = false;
            p.vx = p.vx * 0.98 + p.baseVx * 0.02;
            p.vy = p.vy * 0.98 + p.baseVy * 0.02;
            p.x += p.vx;
            p.y += p.vy;
          }
        }

        // Screen Boundary Logic
        if (p.x < -BOUNDARY_MARGIN) p.x = width + BOUNDARY_MARGIN - 5;
        if (p.x > width + BOUNDARY_MARGIN) p.x = -BOUNDARY_MARGIN + 5;
        if (p.y < -BOUNDARY_MARGIN) p.y = height + BOUNDARY_MARGIN - 5;
        if (p.y > height + BOUNDARY_MARGIN) p.y = -BOUNDARY_MARGIN + 5;
      }

      // 2. Elastic Collisions (Zero Overlap Guaranteed)
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < particles.length; i++) {
          for (let j = i + 1; j < particles.length; j++) {
            const p1 = particles[i];
            const p2 = particles[j];

            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const dist = Math.hypot(dx, dy);
            const minDist = p1.radius + p2.radius + 1.5;

            if (dist < minDist && dist > 0.001) {
              const nx = dx / dist;
              const ny = dy / dist;

              const overlap = minDist - dist;
              const m1 = getMass(p1);
              const m2 = getMass(p2);
              const totalMass = m1 + m2;

              const separationRatio1 = m2 / totalMass;
              const separationRatio2 = m1 / totalMass;

              p1.x -= nx * (overlap * separationRatio1 + 0.6);
              p1.y -= ny * (overlap * separationRatio1 + 0.6);
              p2.x += nx * (overlap * separationRatio2 + 0.6);
              p2.y += ny * (overlap * separationRatio2 + 0.6);

              const dvx = p1.vx - p2.vx;
              const dvy = p1.vy - p2.vy;
              const velAlongNormal = dvx * nx + dvy * ny;

              if (velAlongNormal > -0.2) {
                const restitution = 1.15;
                const ejectionImpulse =
                  ((1 + restitution) * Math.max(0.6, velAlongNormal) + 1.2) /
                  (1 / m1 + 1 / m2);

                p1.vx -= (ejectionImpulse / m1) * nx;
                p1.vy -= (ejectionImpulse / m1) * ny;
                p2.vx += (ejectionImpulse / m2) * nx;
                p2.vy += (ejectionImpulse / m2) * ny;

                if (Math.random() < 0.5) {
                  p1.isOrbiting = false;
                  p1.escapeCooldown = 60;
                }
                if (Math.random() < 0.5) {
                  p2.isOrbiting = false;
                  p2.escapeCooldown = 60;
                }
              }
            }
          }
        }
      }

      // 3. Constellation Lines for Active Elliptical Orbits
      for (const lp of largeParticles) {
        drawOrbitConstellationWeb(lp.x, lp.y, STAR_ORBIT_RADIUS, splitX, false);
      }

      if (mouse) {
        const cursorRGB = getParticleRGB(mouse.x, splitX);
        const cursorGlow = ctx.createRadialGradient(
          mouse.x,
          mouse.y,
          2,
          mouse.x,
          mouse.y,
          26
        );
        cursorGlow.addColorStop(0, `rgba(${cursorRGB.r}, ${cursorRGB.g}, ${cursorRGB.b}, 0.85)`);
        cursorGlow.addColorStop(0.4, `rgba(${cursorRGB.r}, ${cursorRGB.g}, ${cursorRGB.b}, 0.28)`);
        cursorGlow.addColorStop(1, `rgba(${cursorRGB.r}, ${cursorRGB.g}, ${cursorRGB.b}, 0)`);

        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, 26, 0, Math.PI * 2);
        ctx.fillStyle = cursorGlow;
        ctx.fill();

        drawOrbitConstellationWeb(mouse.x, mouse.y, CURSOR_ORBIT_RADIUS, splitX, true);
      }

      // 4. Draw All Particles with TRUE 10% to 100% OPACITY TWINKLE SWING
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        if (p.x < -15 || p.x > width + 15 || p.y < -15 || p.y > height + 15) {
          continue;
        }

        let lifeFade = 1.0;
        if (p.currentAge < 2000) {
          lifeFade = Math.max(0.05, p.currentAge / 2000);
        } else if (p.currentAge > p.baseLifespan) {
          const fadeOutProgress = (p.currentAge - p.baseLifespan) / p.fadeDuration;
          lifeFade = Math.max(0, 1.0 - fadeOutProgress);
        }

        // TRUE 10% TO 100% OPACITY TWINKLE CYCLE
        const wave = 0.5 + 0.5 * Math.sin(frameCount * p.twinkleSpeed + p.twinklePhase);
        const twinkleAlpha = 0.10 + 0.90 * wave;
        const currentAlpha = Math.max(0.04, Math.min(1.0, twinkleAlpha * lifeFade));

        const rgb = getParticleRGB(p.x, splitX);
        const colorStr = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${currentAlpha})`;

        if (p.isLarge) {
          const glowRadius = p.radius * (2.0 + 1.8 * wave);
          const gradient = ctx.createRadialGradient(
            p.x,
            p.y,
            p.radius * 0.4,
            p.x,
            p.y,
            glowRadius
          );
          gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${currentAlpha * 0.95})`);
          gradient.addColorStop(0.35, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${currentAlpha * 0.35})`);
          gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);

          ctx.beginPath();
          ctx.arc(p.x, p.y, glowRadius, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = colorStr;
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = colorStr;
          ctx.fill();
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      clearInterval(periodicSpawnInterval);
      canvas.removeEventListener("mousemove", handlePointerMove);
      canvas.removeEventListener("mouseleave", handlePointerLeave);
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("touchmove", handlePointerMove);
      canvas.removeEventListener("touchstart", handleClick);
      canvas.removeEventListener("touchend", handlePointerLeave);
    };
  }, []);

  return (
    <div ref={containerRef} className={`absolute inset-0 overflow-hidden pointer-events-auto ${className}`}>
      <canvas ref={canvasRef} className="block w-full h-full cursor-crosshair" />
    </div>
  );
};

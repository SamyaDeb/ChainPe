import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from './ui/Motion'

const CHARS = '░▒▓█▀▄▌▐│─┤├┴┬╭╮╰╯'

/**
 * The landing hero's rotating sphere of box-drawing characters. It takes its colour from the
 * current text colour, so it follows the theme. It stops off screen and draws one still frame
 * when reduced motion is on.
 */
export function AnimatedSphere() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const raf = { id: 0 }
    const view = { visible: true, time: 0 }
    const reduced = prefersReducedMotion()

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.scale(dpr, dpr)
    }

    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      ctx.clearRect(0, 0, rect.width, rect.height)
      const centerX = rect.width / 2
      const centerY = rect.height / 2
      const radius = Math.min(rect.width, rect.height) * 0.47
      ctx.font = "12px 'JetBrains Mono Variable', monospace"
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = getComputedStyle(canvas).color

      const points: Array<{ x: number; y: number; z: number; char: string }> = []
      for (let phi = 0; phi < Math.PI * 2; phi += 0.15) {
        for (let theta = 0; theta < Math.PI; theta += 0.15) {
          const x = Math.sin(theta) * Math.cos(phi + view.time * 0.5)
          const y = Math.sin(theta) * Math.sin(phi + view.time * 0.5)
          const z = Math.cos(theta)
          const rotY = view.time * 0.3
          const newX = x * Math.cos(rotY) - z * Math.sin(rotY)
          const newZ = x * Math.sin(rotY) + z * Math.cos(rotY)
          const rotX = view.time * 0.2
          const newY = y * Math.cos(rotX) - newZ * Math.sin(rotX)
          const finalZ = y * Math.sin(rotX) + newZ * Math.cos(rotX)
          const depth = (finalZ + 1) / 2
          points.push({
            x: centerX + newX * radius,
            y: centerY + newY * radius,
            z: finalZ,
            char: CHARS.charAt(Math.floor(depth * (CHARS.length - 1))),
          })
        }
      }
      points.sort((a, b) => a.z - b.z)
      for (const point of points) {
        ctx.globalAlpha = 0.2 + (point.z + 1) * 0.4
        ctx.fillText(point.char, point.x, point.y)
      }
      ctx.globalAlpha = 1
    }

    const loop = () => {
      draw()
      view.time += 0.02
      if (view.visible) raf.id = requestAnimationFrame(loop)
    }

    const redrawOnResize = () => {
      resize()
      if (reduced) draw()
    }

    resize()
    window.addEventListener('resize', redrawOnResize)

    if (reduced) {
      draw()
      return () => window.removeEventListener('resize', redrawOnResize)
    }

    const observer = new IntersectionObserver(([entry]) => {
      const nowVisible = entry?.isIntersecting ?? true
      if (nowVisible && !view.visible) raf.id = requestAnimationFrame(loop)
      view.visible = nowVisible
    })
    observer.observe(canvas)
    raf.id = requestAnimationFrame(loop)

    return () => {
      window.removeEventListener('resize', redrawOnResize)
      observer.disconnect()
      cancelAnimationFrame(raf.id)
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden className="block h-full w-full text-ink" />
}

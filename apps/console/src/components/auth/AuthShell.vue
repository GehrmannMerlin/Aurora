<template>
  <div class="au-auth-shell" data-testid="auth-shell">
    <aside class="au-auth-shell__brand" aria-label="Aurora">
      <div class="au-auth-shell__brand-content">
        <p class="au-auth-shell__wordmark">Aurora</p>
        <p class="au-auth-shell__statement">把异常、请求与性能证据放回同一个调查上下文</p>
      </div>
      <div class="au-auth-shell__orbit" aria-hidden="true">
        <span class="au-auth-shell__orbit-ring au-auth-shell__orbit-ring--outer" />
        <span class="au-auth-shell__orbit-ring au-auth-shell__orbit-ring--inner" />
        <span class="au-auth-shell__orbit-point au-auth-shell__orbit-point--one" />
        <span class="au-auth-shell__orbit-point au-auth-shell__orbit-point--two" />
      </div>
    </aside>

    <main class="au-auth-shell__main">
      <header class="au-auth-shell__compact-brand">Aurora</header>
      <div class="au-auth-shell__form-region">
        <slot />
      </div>
    </main>
  </div>
</template>

<style scoped>
.au-auth-shell {
  display: grid;
  grid-template-columns: minmax(360px, 42%) minmax(0, 1fr);
  min-height: 100dvh;
  background: var(--color-page-bg);
}

.au-auth-shell__brand {
  position: relative;
  display: flex;
  min-height: 100dvh;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  padding: clamp(32px, 5vw, 72px);
  color: var(--color-rail-fg);
  background: var(--color-rail-bg);
}

.au-auth-shell__brand-content {
  position: relative;
  z-index: 1;
  max-width: 360px;
}
.au-auth-shell__wordmark {
  margin: 0 0 var(--space-6);
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.03em;
}
.au-auth-shell__statement {
  margin: 0;
  color: var(--color-rail-muted);
  font-size: 18px;
  line-height: 1.7;
}

.au-auth-shell__orbit {
  position: absolute;
  right: clamp(-112px, -5vw, -48px);
  bottom: clamp(-120px, -7vw, -72px);
  width: min(38vw, 520px);
  aspect-ratio: 1;
}

.au-auth-shell__orbit-ring,
.au-auth-shell__orbit-point {
  position: absolute;
  display: block;
  border: 1px solid color-mix(in srgb, var(--color-rail-muted) 42%, transparent);
  border-radius: 50%;
}
.au-auth-shell__orbit-ring--outer {
  inset: 0;
}
.au-auth-shell__orbit-ring--inner {
  inset: 20%;
}
.au-auth-shell__orbit-point {
  width: 12px;
  aspect-ratio: 1;
  background: var(--color-rail-bg);
}
.au-auth-shell__orbit-point--one {
  top: 13%;
  left: 19%;
}
.au-auth-shell__orbit-point--two {
  right: 11%;
  bottom: 26%;
}

.au-auth-shell__main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  padding: clamp(32px, 7vw, 96px);
}

.au-auth-shell__compact-brand {
  display: none;
}
.au-auth-shell__form-region {
  width: min(100%, 420px);
  margin: 0 auto;
}

@media (max-width: 639px) {
  .au-auth-shell {
    display: block;
    min-height: 100dvh;
  }
  .au-auth-shell__brand {
    display: none;
  }
  .au-auth-shell__main {
    min-height: 100dvh;
    justify-content: flex-start;
    padding: var(--space-5) var(--space-4) var(--space-6);
  }
  .au-auth-shell__compact-brand {
    display: block;
    margin-bottom: clamp(48px, 14vh, 88px);
    color: var(--color-text-primary);
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .au-auth-shell__form-region {
    margin: 0;
  }
}
</style>

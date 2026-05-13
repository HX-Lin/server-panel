(function () {
  var assetVersion = "20260514-interact-modal-v6";
  var backgroundCandidates = [
    "/static/backgrounds/panel-scene.avif?v=" + assetVersion,
    "/static/backgrounds/panel-scene.webp?v=" + assetVersion,
    "/static/backgrounds/panel-scene.png?v=" + assetVersion,
    "/static/backgrounds/panel-scene.jpg?v=" + assetVersion,
    "/static/backgrounds/panel-scene.jpeg?v=" + assetVersion,
    "/static/backgrounds/panel-scene.gif?v=" + assetVersion
  ];

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
      return;
    }
    callback();
  }

  function probeImage(url) {
    return new Promise(function (resolve) {
      var image = new Image();
      image.onload = function () {
        resolve(url);
      };
      image.onerror = function () {
        resolve("");
      };
      image.src = url;
    });
  }

  function ensureSceneLayers() {
    var root = document.getElementById("panel-scene-root");
    var particlesRoot = document.getElementById("panel-particles-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "panel-scene-root";
      root.setAttribute("aria-hidden", "true");

      var background = document.createElement("div");
      background.className = "panel-background";

      var overlay = document.createElement("div");
      overlay.className = "panel-background-overlay";

      root.appendChild(background);
      root.appendChild(overlay);
      document.body.insertBefore(root, document.body.firstChild);
    }

    if (!particlesRoot) {
      particlesRoot = document.createElement("div");
      particlesRoot.id = "panel-particles-root";
      particlesRoot.setAttribute("aria-hidden", "true");

      var particles = document.createElement("div");
      particles.id = "particles-js";
      particles.className = "panel-particles";

      particlesRoot.appendChild(particles);
      document.body.appendChild(particlesRoot);
    }

    return {
      root: root,
      particlesRoot: particlesRoot,
      background: root.querySelector(".panel-background"),
      particles: particlesRoot.querySelector("#particles-js"),
      overlay: root.querySelector(".panel-background-overlay")
    };
  }

  function applyCriticalLayerStyles() {
    var scene = ensureSceneLayers();
    var root = scene.root;
    var particlesRoot = scene.particlesRoot;
    var background = scene.background;
    var particles = scene.particles;
    var overlay = scene.overlay;

    if (root) {
      root.style.position = "fixed";
      root.style.top = "0";
      root.style.right = "0";
      root.style.bottom = "0";
      root.style.left = "0";
      root.style.zIndex = "0";
      root.style.overflow = "hidden";
      root.style.pointerEvents = "none";
    }

    if (particlesRoot) {
      particlesRoot.style.position = "fixed";
      particlesRoot.style.top = "0";
      particlesRoot.style.right = "0";
      particlesRoot.style.bottom = "0";
      particlesRoot.style.left = "0";
      particlesRoot.style.zIndex = "4";
      particlesRoot.style.overflow = "hidden";
      particlesRoot.style.pointerEvents = "none";
    }

    if (background) {
      background.style.position = "absolute";
      background.style.top = "0";
      background.style.right = "0";
      background.style.bottom = "0";
      background.style.left = "0";
      background.style.pointerEvents = "none";
      background.style.backgroundColor = "var(--panel-bg)";
      background.style.backgroundSize = "cover";
      background.style.backgroundPosition = "center";
      background.style.backgroundRepeat = "no-repeat";
    }

    if (particles) {
      particles.style.position = "absolute";
      particles.style.top = "0";
      particles.style.right = "0";
      particles.style.bottom = "0";
      particles.style.left = "0";
      particles.style.zIndex = "0";
      particles.style.width = "100vw";
      particles.style.height = "100vh";
      particles.style.opacity = "0.72";
      particles.style.pointerEvents = "none";
    }

    if (overlay) {
      overlay.style.position = "absolute";
      overlay.style.top = "0";
      overlay.style.right = "0";
      overlay.style.bottom = "0";
      overlay.style.left = "0";
      overlay.style.zIndex = "1";
      overlay.style.pointerEvents = "none";
    }
  }

  async function applyBackgroundImage() {
    var background = ensureSceneLayers().background;
    for (var i = 0; i < backgroundCandidates.length; i += 1) {
      var url = await probeImage(backgroundCandidates[i]);
      if (url) {
        document.documentElement.style.setProperty("--panel-background-url", 'url("' + url + '")');
        document.body.classList.add("panel-has-background");
        if (background) {
          background.style.backgroundImage = 'url("' + url + '")';
        }
        return;
      }
    }
  }

  function buildParticlesConfig(interactive) {
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var particleCount = reduceMotion ? 24 : 56;
    var moveSpeed = reduceMotion ? 0.8 : 2.4;

    return {
      particles: {
        number: {
          value: particleCount,
          density: {
            enable: true,
            value_area: 960
          }
        },
        color: {
          value: "#ffffff"
        },
        shape: {
          type: "circle",
          stroke: {
            width: 0,
            color: "#000000"
          },
          polygon: {
            nb_sides: 5
          }
        },
        opacity: {
          value: 0.34,
          random: true,
          anim: {
            enable: false,
            speed: 1,
            opacity_min: 0.1,
            sync: false
          }
        },
        size: {
          value: 3.2,
          random: true,
          anim: {
            enable: false,
            speed: 40,
            size_min: 0.1,
            sync: false
          }
        },
        line_linked: {
          enable: true,
          distance: 150,
          color: "#ffffff",
          opacity: 0.2,
          width: 1
        },
        move: {
          enable: true,
          speed: moveSpeed,
          direction: "none",
          random: false,
          straight: false,
          out_mode: "out",
          bounce: false,
          attract: {
            enable: false,
            rotateX: 600,
            rotateY: 1200
          }
        }
      },
      interactivity: {
        detect_on: interactive ? "window" : "canvas",
        events: {
          onhover: {
            enable: interactive,
            mode: "repulse"
          },
          onclick: {
            enable: interactive,
            mode: "push"
          },
          resize: true
        },
        modes: {
          grab: {
            distance: 400,
            line_linked: {
              opacity: 1
            }
          },
          bubble: {
            distance: 400,
            size: 32,
            duration: 2,
            opacity: 8,
            speed: 3
          },
          repulse: {
            distance: 180
          },
          push: {
            particles_nb: 3
          },
          remove: {
            particles_nb: 2
          }
        }
      },
      retina_detect: true
    };
  }

  function initParticles() {
    var container = ensureSceneLayers().particles;
    if (!container || typeof window.particlesJS !== "function") {
      return;
    }

    var interactive = document.body.dataset.particlesInteractive !== "false";
    var config = buildParticlesConfig(interactive);
    config.particles.opacity.value = 0.28;
    config.particles.line_linked.opacity = 0.16;
    config.particles.move.speed = 1.8;
    window.particlesJS("particles-js", config);
  }

  onReady(function () {
    applyCriticalLayerStyles();
    applyBackgroundImage();
    initParticles();
  });
})();

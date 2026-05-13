(function () {
  var assetVersion = "20260514-card-grid-v3";
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
    if (!root) {
      root = document.createElement("div");
      root.id = "panel-scene-root";
      root.setAttribute("aria-hidden", "true");

      var background = document.createElement("div");
      background.className = "panel-background";

      var particles = document.createElement("div");
      particles.id = "particles-js";
      particles.className = "panel-particles";

      var overlay = document.createElement("div");
      overlay.className = "panel-background-overlay";

      root.appendChild(background);
      root.appendChild(particles);
      root.appendChild(overlay);
      document.body.insertBefore(root, document.body.firstChild);
    }

    return {
      root: root,
      background: root.querySelector(".panel-background"),
      particles: root.querySelector("#particles-js"),
      overlay: root.querySelector(".panel-background-overlay")
    };
  }

  function applyCriticalLayerStyles() {
    var scene = ensureSceneLayers();
    var root = scene.root;
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
      particles.style.zIndex = "1";
      particles.style.width = "100vw";
      particles.style.height = "100vh";
      particles.style.pointerEvents = "none";
    }

    if (overlay) {
      overlay.style.position = "absolute";
      overlay.style.top = "0";
      overlay.style.right = "0";
      overlay.style.bottom = "0";
      overlay.style.left = "0";
      overlay.style.zIndex = "2";
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
        detect_on: "canvas",
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

    window.particlesJS("particles-js", buildParticlesConfig(false));
  }

  onReady(function () {
    applyCriticalLayerStyles();
    applyBackgroundImage();
    initParticles();
  });
})();

(function () {
  var assetVersion = "20260514-scene-fix";
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

  function applyCriticalLayerStyles() {
    var background = document.querySelector(".panel-background");
    var particles = document.getElementById("particles-js");
    var overlay = document.querySelector(".panel-background-overlay");
    var interactive = document.body.dataset.particlesInteractive !== "false";

    if (background) {
      background.style.position = "fixed";
      background.style.inset = "0";
      background.style.zIndex = "0";
      background.style.pointerEvents = "none";
      background.style.backgroundColor = "var(--panel-bg)";
      background.style.backgroundSize = "cover";
      background.style.backgroundPosition = "center";
      background.style.backgroundRepeat = "no-repeat";
    }

    if (particles) {
      particles.style.position = "fixed";
      particles.style.inset = "0";
      particles.style.zIndex = "1";
      particles.style.width = "100vw";
      particles.style.height = "100vh";
      particles.style.pointerEvents = interactive ? "auto" : "none";
    }

    if (overlay) {
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.zIndex = "2";
      overlay.style.pointerEvents = "none";
    }
  }

  async function applyBackgroundImage() {
    var background = document.querySelector(".panel-background");
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
    var container = document.getElementById("particles-js");
    if (!container || typeof window.particlesJS !== "function") {
      return;
    }

    var interactive = document.body.dataset.particlesInteractive !== "false";
    window.particlesJS("particles-js", buildParticlesConfig(interactive));
  }

  onReady(function () {
    applyCriticalLayerStyles();
    applyBackgroundImage();
    initParticles();
  });
})();

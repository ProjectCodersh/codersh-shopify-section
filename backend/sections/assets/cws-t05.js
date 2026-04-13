/* ============================================================
   cws-t05.js — T05 Center Carousel | Codersh Sections
   Handles: prev/next/dot navigation, keyboard, swipe, side-click
   Scoped per section instance — supports multiple on same page
   ============================================================ */

(function () {
  'use strict';

  function initCarousel(section) {
    var cards   = Array.from(section.querySelectorAll('.t05__card'));
    var dots    = Array.from(section.querySelectorAll('.t05__dot'));
    var btnPrev = section.querySelector('.t05__arrow--prev');
    var btnNext = section.querySelector('.t05__arrow--next');

    if (!cards.length) return;

    var total   = cards.length;
    var current = 0;

    /* ── Core: go to index ── */
    function goTo(idx) {
      idx = ((idx % total) + total) % total;

      var prev = (idx - 1 + total) % total;
      var next = (idx + 1) % total;

      cards.forEach(function (card, i) {
        if (i === idx)       card.dataset.pos = 'center';
        else if (i === prev) card.dataset.pos = 'left';
        else if (i === next) card.dataset.pos = 'right';
        else                 card.dataset.pos = 'hidden';
      });

      dots.forEach(function (dot, i) {
        var isActive = i === idx;
        dot.classList.toggle('t05__dot--active', isActive);
        dot.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      current = idx;
    }

    /* ── Arrow buttons ── */
    if (btnPrev) {
      btnPrev.addEventListener('click', function () {
        goTo(current - 1);
      });
    }

    if (btnNext) {
      btnNext.addEventListener('click', function () {
        goTo(current + 1);
      });
    }

    /* ── Dot clicks ── */
    dots.forEach(function (dot) {
      dot.addEventListener('click', function () {
        goTo(parseInt(this.dataset.index, 10));
      });
    });

    /* ── Side card click ── */
    cards.forEach(function (card) {
      card.addEventListener('click', function () {
        var pos = this.dataset.pos;
        if (pos === 'left')  goTo(current - 1);
        if (pos === 'right') goTo(current + 1);
      });
    });

    /* ── Keyboard navigation ── */
    section.setAttribute('tabindex', '0');
    section.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); goTo(current - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(current + 1); }
    });

    /* ── Touch / Swipe ── */
    var touchStartX = 0;
    var touchStartY = 0;
    var isDragging  = false;

    section.addEventListener('touchstart', function (e) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      isDragging  = false;
    }, { passive: true });

    section.addEventListener('touchmove', function (e) {
      var dx = Math.abs(e.touches[0].clientX - touchStartX);
      var dy = Math.abs(e.touches[0].clientY - touchStartY);
      if (dx > dy && dx > 8) isDragging = true;
    }, { passive: true });

    section.addEventListener('touchend', function (e) {
      if (!isDragging) return;
      var diff = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(diff) > 40) {
        goTo(diff < 0 ? current + 1 : current - 1);
      }
      isDragging = false;
    });

    /* ── Mouse drag (desktop) ── */
    var mouseStartX = 0;
    var mouseDragging = false;

    section.addEventListener('mousedown', function (e) {
      mouseStartX   = e.clientX;
      mouseDragging = false;
    });

    section.addEventListener('mousemove', function (e) {
      if (Math.abs(e.clientX - mouseStartX) > 8) mouseDragging = true;
    });

    section.addEventListener('mouseup', function (e) {
      if (!mouseDragging) return;
      var diff = e.clientX - mouseStartX;
      if (Math.abs(diff) > 40) {
        goTo(diff < 0 ? current + 1 : current - 1);
      }
      mouseDragging = false;
    });

    /* ── Auto-play (optional, pause on hover/focus) ── */
    var autoPlay = section.dataset.autoplay;
    if (autoPlay && parseInt(autoPlay, 10) > 0) {
      var interval = setInterval(function () {
        goTo(current + 1);
      }, parseInt(autoPlay, 10));

      section.addEventListener('mouseenter', function () { clearInterval(interval); });
      section.addEventListener('focusin',    function () { clearInterval(interval); });
    }
  }

  /* ── Init all carousels on page load ── */
  function initAll() {
    document.querySelectorAll('.t05[data-section-id]').forEach(function (section) {
      initCarousel(section);
    });
  }

  /* ── Shopify theme editor re-init on section changes ── */
  if (window.Shopify && Shopify.designMode) {
    document.addEventListener('shopify:section:load', function (e) {
      var section = e.target.querySelector('.t05[data-section-id]');
      if (section) initCarousel(section);
    });

    document.addEventListener('shopify:block:select', function (e) {
      var section = e.target.closest('.t05[data-section-id]');
      if (!section) return;
      var card = e.target.closest('.t05__card');
      if (!card) return;
      var idx = parseInt(card.dataset.index, 10);
      if (!isNaN(idx)) {
        var inst = section.querySelector('.t05__arrow--next');
        if (inst) {
          var current = Array.from(section.querySelectorAll('.t05__card'))
            .findIndex(function (c) { return c.dataset.pos === 'center'; });
          if (current !== idx) {
            var cards = section.querySelectorAll('.t05__card');
            var dots  = section.querySelectorAll('.t05__dot');
            var total = cards.length;
            var prev  = (idx - 1 + total) % total;
            var next  = (idx + 1) % total;
            cards.forEach(function (c, i) {
              if (i === idx)       c.dataset.pos = 'center';
              else if (i === prev) c.dataset.pos = 'left';
              else if (i === next) c.dataset.pos = 'right';
              else                 c.dataset.pos = 'hidden';
            });
            dots.forEach(function (d, i) {
              d.classList.toggle('t05__dot--active', i === idx);
              d.setAttribute('aria-selected', i === idx ? 'true' : 'false');
            });
          }
        }
      }
    });
  }

  /* ── Run ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

})();

/**
 * Shirjan Khadka Portfolio - Main JavaScript
 * Domain: shirjankhadka.com.np
 * Features: Scroll reveal, animated counters, mobile menu, glassmorphic header,
 *           event photo lightbox, copy-to-clipboard, contact form validation.
 */

document.addEventListener('DOMContentLoaded', () => {

  // --- Dynamic Footer Year ---
  const footerYear = document.getElementById('footer-year');
  if (footerYear) {
    footerYear.textContent = new Date().getFullYear();
  }

  // --- Sticky Header Scroll Effect ---
  const header = document.getElementById('site-header');
  const handleHeaderScroll = () => {
    if (window.scrollY > 40) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  };
  window.addEventListener('scroll', handleHeaderScroll, { passive: true });
  handleHeaderScroll();

  // --- Mobile Menu Toggle ---
  const menuToggle = document.getElementById('menu-toggle');
  const navMenu = document.getElementById('nav-menu');
  const navLinks = document.querySelectorAll('.nav-link, .btn-nav-cta');

  if (menuToggle && navMenu) {
    menuToggle.addEventListener('click', () => {
      const isOpen = navMenu.classList.toggle('is-open');
      menuToggle.classList.toggle('is-active');
      menuToggle.setAttribute('aria-expanded', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        if (navMenu.classList.contains('is-open')) {
          navMenu.classList.remove('is-open');
          menuToggle.classList.remove('is-active');
          menuToggle.setAttribute('aria-expanded', 'false');
          document.body.style.overflow = '';
        }
      });
    });
  }

  // --- Active Nav Link Highlighting on Scroll ---
  const sections = document.querySelectorAll('section[id]');
  const navObserverOptions = {
    root: null,
    rootMargin: '-20% 0px -60% 0px',
    threshold: 0
  };

  const navObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute('id');
        document.querySelectorAll('.nav-link').forEach(link => {
          if (link.getAttribute('href') === `#${id}`) {
            link.classList.add('active');
          } else {
            link.classList.remove('active');
          }
        });
      }
    });
  }, navObserverOptions);

  sections.forEach(section => navObserver.observe(section));

  // --- Scroll Reveal Animations ---
  const revealElements = document.querySelectorAll('.reveal-on-scroll');
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      }
    });
  }, {
    root: null,
    threshold: 0.12
  });

  revealElements.forEach(el => revealObserver.observe(el));

  // --- Animated Numerical Stat Counters ---
  const statNumbers = document.querySelectorAll('.stat-number');
  let hasAnimatedStats = false;

  const animateCounters = () => {
    statNumbers.forEach(stat => {
      const targetStr = stat.getAttribute('data-target');
      const suffix = stat.getAttribute('data-suffix') || '';
      const decimals = parseInt(stat.getAttribute('data-decimals') || '0', 10);
      const target = parseFloat(targetStr);
      const duration = 1800; // ms
      const startTime = performance.now();

      const updateCount = (currentTime) => {
        const elapsedTime = currentTime - startTime;
        const progress = Math.min(elapsedTime / duration, 1);
        // Ease-out cubic formula
        const easeProgress = 1 - Math.pow(1 - progress, 3);
        const currentVal = target * easeProgress;

        if (decimals > 0) {
          stat.textContent = currentVal.toFixed(decimals) + suffix;
        } else {
          stat.textContent = Math.floor(currentVal) + suffix;
        }

        if (progress < 1) {
          requestAnimationFrame(updateCount);
        } else {
          stat.textContent = (decimals > 0 ? target.toFixed(decimals) : target) + suffix;
        }
      };

      requestAnimationFrame(updateCount);
    });
  };

  const statsSection = document.querySelector('.stats-grid');
  if (statsSection) {
    const statsObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !hasAnimatedStats) {
          hasAnimatedStats = true;
          animateCounters();
        }
      });
    }, { threshold: 0.3 });

    statsObserver.observe(statsSection);
  }

  // --- Event Lightbox Modal ---
  const lightboxModal = document.getElementById('lightbox-modal');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxClose = document.getElementById('lightbox-close');
  const galleryItems = document.querySelectorAll('.gallery-item');

  if (lightboxModal && lightboxImg) {
    galleryItems.forEach(item => {
      item.addEventListener('click', () => {
        const imgSrc = item.getAttribute('data-image');
        if (imgSrc) {
          lightboxImg.src = imgSrc;
          lightboxModal.classList.add('is-open');
          lightboxModal.setAttribute('aria-hidden', 'false');
          document.body.style.overflow = 'hidden';
        }
      });
    });

    const closeLightbox = () => {
      lightboxModal.classList.remove('is-open');
      lightboxModal.setAttribute('aria-hidden', 'true');
      lightboxImg.src = '';
      document.body.style.overflow = '';
    };

    if (lightboxClose) {
      lightboxClose.addEventListener('click', closeLightbox);
    }

    lightboxModal.addEventListener('click', (e) => {
      if (e.target === lightboxModal) {
        closeLightbox();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lightboxModal.classList.contains('is-open')) {
        closeLightbox();
      }
    });
  }

  // --- Copy to Clipboard Contact Cards ---
  const copyCards = document.querySelectorAll('.contact-card[data-copy]');
  copyCards.forEach(card => {
    card.addEventListener('click', () => {
      const textToCopy = card.getAttribute('data-copy');
      const tipElement = card.querySelector('.contact-copy-tip');
      const originalTipText = tipElement ? tipElement.textContent : '';

      navigator.clipboard.writeText(textToCopy).then(() => {
        if (tipElement) {
          tipElement.textContent = '✓ Copied to clipboard!';
          tipElement.style.color = 'var(--amber)';
          setTimeout(() => {
            tipElement.textContent = originalTipText;
            tipElement.style.color = '';
          }, 2000);
        }
      }).catch(err => {
        console.error('Failed to copy: ', err);
      });
    });
  });

  // --- Interactive Contact Form Handling ---
  const contactForm = document.getElementById('contact-form');
  const formStatus = document.getElementById('form-status');

  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = contactForm.querySelector('button[type="submit"]');
      const originalBtnHtml = submitBtn.innerHTML;

      submitBtn.disabled = true;
      submitBtn.innerHTML = 'Sending...';

      try {
        const formData = new FormData(contactForm);
        const response = await fetch(contactForm.action, {
          method: 'POST',
          body: formData,
          headers: {
            'Accept': 'application/json'
          }
        });

        if (response.ok) {
          formStatus.className = 'form-status-msg is-success';
          formStatus.textContent = '✓ Thank you! Your message has been sent successfully. I will get back to you soon.';
          contactForm.reset();
        } else {
          const data = await response.json();
          formStatus.className = 'form-status-msg is-error';
          if (data && data.errors) {
            formStatus.textContent = data.errors.map(error => error.message).join(', ');
          } else {
            formStatus.textContent = 'Oops! There was a problem submitting your form. Please try again or email directly.';
          }
        }
      } catch (error) {
        formStatus.className = 'form-status-msg is-error';
        formStatus.textContent = 'Oops! Network error. Please try sending again or contact via email.';
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
      }
    });
  }

});

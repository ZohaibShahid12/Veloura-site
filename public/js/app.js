(() => {
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];

  const header = $('#siteHeader');
  if (header) {
    const updateHeader = () => header.classList.toggle('scrolled', window.scrollY > 30);
    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive:true });
  }

  const menuToggle = $('[data-menu-toggle]');
  const menu = $('[data-mobile-menu]');
  if (menuToggle && menu) {
    menuToggle.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      document.body.classList.toggle('menu-open', open);
      menuToggle.setAttribute('aria-expanded', String(open));
    });
    $$('a', menu).forEach(a => a.addEventListener('click', () => {
      menu.classList.remove('open'); document.body.classList.remove('menu-open');
    }));
  }

  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); } });
  }, { threshold:.08 }) : null;
  $$('.reveal').forEach(el => observer ? observer.observe(el) : el.classList.add('visible'));

  const filterToggle = $('[data-filter-toggle]');
  const filterPanel = $('.filter-panel');
  if (filterToggle && filterPanel) filterToggle.addEventListener('click', () => filterPanel.classList.toggle('open'));

  $$('[data-modal-open]').forEach(button => button.addEventListener('click', () => {
    const modal = document.getElementById(button.dataset.modalOpen);
    if (modal) { modal.classList.add('open'); document.body.classList.add('modal-open'); }
  }));
  $$('[data-modal-close]').forEach(button => button.addEventListener('click', () => {
    const modal = button.closest('[data-modal]');
    if (modal) { modal.classList.remove('open'); document.body.classList.remove('modal-open'); }
  }));
  $$('[data-modal]').forEach(modal => modal.addEventListener('click', e => {
    if (e.target === modal) { modal.classList.remove('open'); document.body.classList.remove('modal-open'); }
  }));

  $$('[data-password-toggle]').forEach(button => button.addEventListener('click', () => {
    const input = button.parentElement.querySelector('input');
    input.type = input.type === 'password' ? 'text' : 'password';
    button.textContent = input.type === 'password' ? 'Show' : 'Hide';
  }));

  const portalToggle = $('[data-portal-toggle]');
  const portalSidebar = $('[data-portal-sidebar]');
  if (portalToggle && portalSidebar) {
    portalToggle.addEventListener('click', () => portalSidebar.classList.toggle('open'));
    document.addEventListener('click', e => {
      if (window.innerWidth <= 980 && portalSidebar.classList.contains('open') && !portalSidebar.contains(e.target) && !portalToggle.contains(e.target)) portalSidebar.classList.remove('open');
    });
  }

  const bookingApp = $('[data-booking-app]');
  if (bookingApp) {
    const form = $('#bookingForm', bookingApp);
    const steps = $$('.booking-step', bookingApp);
    const dots = $$('[data-step-dot]', bookingApp);
    const branch = $('#branchSelect', bookingApp);
    const staff = $('#staffSelect', bookingApp);
    const date = $('#bookingDate', bookingApp);
    const startTime = $('#startTime', bookingApp);
    const slots = $('#timeSlots', bookingApp);
    const loader = $('#slotLoader', bookingApp);
    const checks = $$('input[name="service_ids"]', bookingApp);
    const homeAddress = $('[data-home-address]', bookingApp);
    let current = 1;

    const selectedServices = () => checks.filter(c => c.checked);
    const selectedServiceIds = () => selectedServices().map(c => c.value);
    const selectedDuration = () => selectedServices().reduce((a,c) => a + Number(c.dataset.duration || 0), 0);
    const selectedTotal = () => selectedServices().reduce((a,c) => a + Number(c.dataset.price || 0), 0);
    const currency = value => `PKR ${Math.round(value).toLocaleString('en-PK')}`;

    function updateSelection() {
      $('#selectedCount', bookingApp).textContent = selectedServices().length;
      $('#selectedDuration', bookingApp).textContent = selectedDuration();
      $('#selectedTotal', bookingApp).textContent = currency(selectedTotal());
      startTime.value = '';
      slots.innerHTML = '';
      loadSlots();
    }
    checks.forEach(c => c.addEventListener('change', updateSelection));
    updateSelection();

    $$('input[name="visit_type"]', bookingApp).forEach(r => r.addEventListener('change', () => {
      homeAddress.classList.toggle('hidden', r.value !== 'home' || !r.checked);
    }));

    function showStep(number) {
      current = Math.min(5, Math.max(1, number));
      steps.forEach(s => s.classList.toggle('active', Number(s.dataset.step) === current));
      dots.forEach(d => d.classList.toggle('active', Number(d.dataset.stepDot) <= current));
      bookingApp.scrollIntoView({ behavior:'smooth', block:'start' });
    }

    function validateStep(step) {
      if (step === 1 && !branch.value) return fail('Please select a salon branch.');
      if (step === 2 && !selectedServices().length) return fail('Please select at least one service.');
      if (step === 3 && (!date.value || !startTime.value)) return fail('Please choose a date and an available time.');
      if (step === 4) {
        const required = $$('[data-step="4"] [required]', bookingApp);
        for (const field of required) if (!field.value.trim()) { field.focus(); return fail('Please complete your contact details.'); }
      }
      return true;
    }
    function fail(message) {
      const old = $('.booking-inline-error', bookingApp); if (old) old.remove();
      const div = document.createElement('div'); div.className='booking-inline-error notice-box'; div.textContent=message;
      $('.booking-step.active', bookingApp).prepend(div); setTimeout(()=>div.remove(),3500); return false;
    }
    $$('[data-next]', bookingApp).forEach(b => b.addEventListener('click', () => {
      if (!validateStep(current)) return;
      if (current === 4) buildReview();
      showStep(current + 1);
    }));
    $$('[data-back]', bookingApp).forEach(b => b.addEventListener('click', () => showStep(current - 1)));
    dots.forEach(d => d.addEventListener('click', () => { const target=Number(d.dataset.stepDot); if(target<current)showStep(target); }));

    function buildReview() {
      const visit = $('input[name="visit_type"]:checked', bookingApp)?.value || 'salon';
      const branchName = branch.options[branch.selectedIndex]?.text || '—';
      const staffName = staff.value ? staff.options[staff.selectedIndex]?.text : 'Any available expert';
      const names = selectedServices().map(c => c.closest('.service-choice').querySelector('b').textContent).join(', ');
      $('#bookingReview', bookingApp).innerHTML = `<div class="review-booking-grid"><div><small>Visit</small><b>${visit}</b></div><div><small>Branch</small><b>${branchName}</b></div><div><small>Services</small><b>${names}</b></div><div><small>Expert</small><b>${staffName}</b></div><div><small>Date and time</small><b>${date.value} · ${startTime.value}</b></div><div><small>Estimated total</small><b>${currency(selectedTotal() + (visit === 'home' ? 1500 : 0))}</b></div></div>`;
    }

    let slotRequest = 0;
    async function loadSlots() {
      slots.innerHTML=''; startTime.value='';
      const ids=selectedServiceIds();
      if(!branch.value || !date.value || !ids.length){loader.style.display='block';loader.textContent='Choose a branch, services and date to load live availability.';return;}
      loader.style.display='block'; loader.textContent='Checking real availability…';
      const request=++slotRequest;
      try{
        const params=new URLSearchParams({branch_id:branch.value,staff_id:staff.value,date:date.value,service_ids:ids.join(',')});
        const response=await fetch(`/api/availability?${params}`); const data=await response.json(); if(request!==slotRequest)return;
        loader.style.display=data.slots.length?'none':'block'; loader.textContent=data.slots.length?'':'No available times for this selection. Try another date or expert.';
        data.slots.forEach(slot=>{const button=document.createElement('button');button.type='button';button.className='time-slot';button.textContent=slot.label;button.title=slot.staff.map(s=>s.name).join(', ');button.addEventListener('click',()=>{$$('.time-slot',slots).forEach(x=>x.classList.remove('selected'));button.classList.add('selected');startTime.value=slot.time;if(!staff.value && slot.staff[0])staff.value=String(slot.staff[0].id);});slots.appendChild(button);});
      }catch(error){loader.style.display='block';loader.textContent='Availability could not be loaded. Please retry.';}
    }
    [branch,staff,date].forEach(el=>el.addEventListener('change',loadSlots));
    branch.addEventListener('change',()=>{ $$('option',staff).forEach(o=>{if(!o.value)return;o.hidden=o.dataset.branch!==branch.value;}); if(staff.selectedOptions[0]?.hidden)staff.value=''; });

    form.addEventListener('submit', e => {
      if(!validateStep(5)){e.preventDefault();return;}
      const button=form.querySelector('button[type="submit"]'); button.disabled=true; button.textContent='Confirming securely…';
    });
  }

  const serviceFilm = $('#serviceFilm');
  const filmButtons = $$('[data-service-film-button]');
  if (serviceFilm && filmButtons.length) {
    const filmTitle = $('#serviceFilmTitle');
    const filmDescription = $('#serviceFilmDescription');
    const filmCta = $('#serviceFilmCta');
    filmButtons.forEach(button => button.addEventListener('click', async () => {
      if (button.classList.contains('active')) return;
      filmButtons.forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });
      serviceFilm.classList.add('is-switching');
      await new Promise(resolve => setTimeout(resolve, 180));
      serviceFilm.pause();
      serviceFilm.poster = button.dataset.poster;
      serviceFilm.src = button.dataset.src;
      serviceFilm.load();
      filmTitle.textContent = button.dataset.title;
      filmDescription.textContent = button.dataset.description;
      filmCta.href = button.dataset.href;
      filmCta.textContent = button.dataset.title.includes('Bridal') ? 'Explore the Bridal Atelier' : 'Explore massage services';
      serviceFilm.classList.remove('is-switching');
      serviceFilm.play().catch(() => {});
    }));
  }

  $$('form').forEach(form => {
    if (form.id === 'bookingForm') return;
    form.addEventListener('submit', () => {
      const button = form.querySelector('button[type="submit"],button:not([type])');
      if (button && !form.getAttribute('onsubmit')) { button.dataset.originalText=button.textContent; button.disabled=true; button.textContent='Please wait…'; }
    });
  });

  setTimeout(() => $$('.toast').forEach(t => t.remove()), 6500);
})();

// FOXXY revamp — subtle 3D tilt on era cards (skipped for reduced motion / touch)
(function(){
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (window.matchMedia('(hover: none)').matches) return;
  var els = document.querySelectorAll('.es-card, .tilt');
  [].forEach.call(els, function(el){
    el.addEventListener('pointermove', function(e){
      var r = el.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      el.style.transform = 'perspective(900px) rotateY(' + (x * 10).toFixed(2) + 'deg) rotateX(' + (-y * 10).toFixed(2) + 'deg) translateZ(6px)';
    });
    el.addEventListener('pointerleave', function(){ el.style.transform = ''; });
  });
})();

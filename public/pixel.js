// Meta (Facebook) Pixel for the registration page: the snippet from the ad manager, kept as a file of our own because the page's strict
// Content-Security-Policy does not allow inline scripts. It is loaded from <head> in register.html. It loads connect.facebook.net/en_US/fbevents.js,
// then init + PageView. register.js sends the "Lead" event after a successful registration.
// To change the pixel, change the number in fbq('init', ...) below and in the <noscript> image in register.html.
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '2822992388094391');
fbq('track', 'PageView');

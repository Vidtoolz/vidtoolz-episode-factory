(function () {
  'use strict';

  function fallbackCopy(text) {
    var textarea = document.createElement('textarea');
    textarea.value = String(text == null ? '' : text);
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    var copied = false;
    try {
      copied = document.execCommand('copy');
    } finally {
      document.body.removeChild(textarea);
    }
    if (!copied) {
      throw new Error('Clipboard copy command was rejected.');
    }
  }

  window.copyToClipboard = function (text, onSuccess, onFail) {
    var value = String(text == null ? '' : text);
    var success = typeof onSuccess === 'function' ? onSuccess : function () {};
    var fail = typeof onFail === 'function' ? onFail : function () {};

    function tryFallback(error) {
      try {
        fallbackCopy(value);
        success();
      } catch (fallbackError) {
        fail(fallbackError || error);
      }
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(value).then(success, tryFallback);
      return;
    }
    tryFallback();
  };
}());

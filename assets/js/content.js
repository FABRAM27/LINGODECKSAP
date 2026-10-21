(function (Bellasprak) {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/\n/g, ' ');
  }

  function sanitizeHtml(value) {
    var parser = new DOMParser();
    var doc = parser.parseFromString('<div>' + String(value == null ? '' : value) + '</div>', 'text/html');
    var root = doc.body.firstElementChild;
    var allowed = ['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'SPAN', 'DIV', 'P', 'UL', 'OL', 'LI', 'SUB', 'SUP', 'SMALL', 'MARK', 'RUBY', 'RT', 'RB'];
    var nodes = Array.prototype.slice.call(root.querySelectorAll('*'));

    nodes.forEach(function (node) {
      if (allowed.indexOf(node.tagName) === -1) {
        node.replaceWith(doc.createTextNode(node.textContent || ''));
        return;
      }

      Array.prototype.slice.call(node.attributes).forEach(function (attribute) {
        if (attribute.name !== 'lang' && attribute.name !== 'dir') {
          node.removeAttribute(attribute.name);
        }
      });
    });

    return root.innerHTML;
  }

  function stripHtml(value) {
    var element = document.createElement('div');
    element.innerHTML = sanitizeHtml(value);
    return (element.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeAnswer(value) {
    return stripHtml(value)
      .normalize('NFC')
      .toLocaleLowerCase()
      .replace(/[“”„]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeUploadedText(text) {
    var lines = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
    var headers = [];
    var dataLines = [];

    lines.forEach(function (line) {
      var trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.charAt(0) === '#') {
        headers.push(trimmed);
      } else {
        dataLines.push(trimmed);
      }
    });

    if (!dataLines.length) {
      return lines.join(' ');
    }

    return headers.join(' ') + ' ' + dataLines.join('↓');
  }

  function removeMetadata(raw) {
    return raw
      .replace(/^\uFEFF/, '')
      .replace(/#separator\s*:\s*pipe/gi, ' ')
      .replace(/#html\s*:\s*(?:true|false)/gi, ' ')
      .replace(/#notetype\s+column\s*:\s*\d+/gi, ' ')
      .replace(/#deck\s+column\s*:\s*\d+/gi, ' ')
      .replace(/\r?\n+/g, '↓')
      .trim();
  }

  function parseData(raw) {
    var clean = removeMetadata(String(raw || ''));
    if (!clean) {
      throw new Error('Add Anki data before parsing.');
    }

    var rawRecords = clean.split('↓').map(function (row) {
      return row.trim();
    }).filter(Boolean);

    var parsed = [];
    var errors = 0;
    var maxFields = 0;
    var widths = [];

    rawRecords.forEach(function (row, index) {
      var pipeParts = row.split('|');
      if (pipeParts.length < 3) {
        errors += 1;
        return;
      }

      var noteType = pipeParts.shift().trim();
      var deck = pipeParts.shift().trim();
      var remainder = pipeParts.join('|').trim();
      var fields = remainder.indexOf('↑') >= 0 ? remainder.split('↑') : pipeParts;
      fields = fields.map(function (field) {
        return field.trim();
      });

      if (!deck || !fields.length) {
        errors += 1;
        return;
      }

      maxFields = Math.max(maxFields, fields.length);
      widths.push(fields.length);
      parsed.push({
        id: 'row-' + Date.now().toString(36) + '-' + index,
        noteType: noteType || 'Basic',
        deck: deck,
        fields: fields
      });
    });

    if (!parsed.length) {
      throw new Error('No valid records found. Each row needs note type, deck, and at least one field.');
    }

    parsed.forEach(function (record) {
      while (record.fields.length < maxFields) {
        record.fields.push('');
      }
    });

    return {
      records: parsed,
      maxFields: maxFields,
      errors: errors,
      inconsistentWidths: new Set(widths).size > 1
    };
  }

  Bellasprak.content = { escapeHtml: escapeHtml, escapeAttr: escapeAttr, sanitizeHtml: sanitizeHtml, stripHtml: stripHtml, normalizeAnswer: normalizeAnswer, normalizeUploadedText: normalizeUploadedText, parseData: parseData };
}(window.Bellasprak = window.Bellasprak || {}));

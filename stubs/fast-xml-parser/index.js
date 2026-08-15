"use strict";

const htmlparser2 = require("htmlparser2");

class XMLParser {
  constructor(options) {
    options = options || {};
    this.options = {
      attributeNamePrefix: options.attributeNamePrefix !== undefined ? options.attributeNamePrefix : '@_',
      ignoreAttributes: options.ignoreAttributes !== undefined ? options.ignoreAttributes : false,
      parseTagValue: options.parseTagValue !== undefined ? options.parseTagValue : true,
      textNodeName: options.textNodeName || '#text',
      cdataPropName: options.cdataPropName || '__cdata',
      isArray: options.isArray || null,
    };
    this.entities = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    };
  }

  addEntity(name, value) {
    this.entities[name] = value;
  }

  parse(xmlData) {
    if (!xmlData || typeof xmlData !== 'string' || !xmlData.trim()) return {};

    const opts = this.options;
    const entities = this.entities;
    const stack = [{ tag: '__root__', attrs: {}, children: [], text: '' }];

    const decodeText = (str) => {
      if (!str) return str;
      return str.replace(/&([^;]+);/g, (m, e) => {
        if (entities[e] !== undefined) return entities[e];
        if (e.startsWith('#x')) return String.fromCharCode(parseInt(e.slice(2), 16));
        if (e.startsWith('#')) return String.fromCharCode(parseInt(e.slice(1), 10));
        return m;
      });
    };

    const coerce = (val) => {
      if (!opts.parseTagValue) return val;
      if (val === '') return val;
      if (val === 'true') return true;
      if (val === 'false') return false;
      const n = Number(val);
      if (!isNaN(n) && String(val).trim() !== '') return n;
      return val;
    };

    const nodeToValue = (node) => {
      const hasChildren = node.children.length > 0;
      const hasText = node.text && node.text.trim() !== '';
      const hasAttrs = !opts.ignoreAttributes && node.attrs && Object.keys(node.attrs).length > 0;

      let value;

      if (!hasChildren && !hasAttrs) {
        value = coerce(decodeText(node.text));
      } else {
        value = {};

        if (hasText) {
          value[opts.textNodeName] = coerce(decodeText(node.text));
        }

        for (const child of node.children) {
          const key = child.tag;
          const childVal = nodeToValue(child);
          const forceArray = opts.isArray ? opts.isArray(key, '', !child.children.length, false) : false;
          if (key in value) {
            if (!Array.isArray(value[key])) value[key] = [value[key]];
            value[key].push(childVal);
          } else if (forceArray) {
            value[key] = [childVal];
          } else {
            value[key] = childVal;
          }
        }

        if (hasAttrs) {
          const prefix = opts.attributeNamePrefix;
          for (const [k, v] of Object.entries(node.attrs)) {
            value[prefix + k] = v;
          }
        }
      }

      return value;
    };

    const parser = new htmlparser2.Parser(
      {
        onopentag(name, attrs) {
          stack.push({ tag: name, attrs: attrs || {}, children: [], text: '' });
        },
        ontext(text) {
          const cur = stack[stack.length - 1];
          cur.text = (cur.text || '') + text;
        },
        oncdata(data) {
          const cur = stack[stack.length - 1];
          cur.text = (cur.text || '') + data;
        },
        onclosetag() {
          const node = stack.pop();
          const parent = stack[stack.length - 1];
          if (parent) parent.children.push(node);
        },
      },
      { xmlMode: true, decodeEntities: false }
    );

    parser.write(xmlData);
    parser.end();

    const root = stack[0];
    if (!root.children.length) return {};

    const result = {};
    for (const child of root.children) {
      result[child.tag] = nodeToValue(child);
    }
    return result;
  }
}

class XMLBuilder {
  constructor(options) { this.options = options || {}; }
  build(jObj) { return ''; }
}

const XMLValidator = { validate: () => true };

module.exports = { XMLParser, XMLBuilder, XMLValidator };

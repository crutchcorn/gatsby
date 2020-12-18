"use strict"

const URI = require(`urijs`)

const fs = require(`fs`)
const LZString = require(`lz-string`)
const { join } = require(`path`)
const map = require(`unist-util-map`)
const normalizePath = require(`normalize-path`)
const npa = require(`npm-package-arg`)

const {
  OPTION_DEFAULT_LINK_TEXT,
  PROTOCOL_BABEL,
  PROTOCOL_CODEPEN,
  PROTOCOL_CODE_SANDBOX,
  PROTOCOL_RAMDA,
  PROTOCOL_STACKBLITZ,
  OPTION_DEFAULT_CODESANDBOX,
  OPTION_DEFAULT_STACKBLITZ,
} = require(`./constants`)

function uuidv4() {
  return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c == `x` ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Matches compression used in Babel and CodeSandbox REPLs
// https://github.com/babel/website/blob/master/js/repl/UriUtils.js
const compress = string =>
  LZString.compressToBase64(string)
    .replace(/\+/g, `-`) // Convert '+' to '-'
    .replace(/\//g, `_`) // Convert '/' to '_'
    .replace(/=+$/, ``) // Remove ending '='

function convertNodeToLink(node, text, href, target) {
  target = target ? `target="${target}" rel="noreferrer"` : ``

  delete node.children
  delete node.position
  delete node.title
  delete node.url

  node.type = `html`
  node.value = `<a href="${href}" ${target}>${text}</a>`
}

module.exports = (
  { markdownAST },
  {
    directory,
    target,
    defaultText = OPTION_DEFAULT_LINK_TEXT,
    codesandbox = OPTION_DEFAULT_CODESANDBOX,
  } = {}
) => {
  codesandbox = {
    ...OPTION_DEFAULT_CODESANDBOX,
    ...OPTION_DEFAULT_STACKBLITZ,
    ...codesandbox,
  }
  if (!directory) {
    throw Error(`Required REPL option "directory" not specified`)
  } else if (!fs.existsSync(directory)) {
    throw Error(`Invalid REPL directory specified "${directory}"`)
  } else if (!directory.endsWith(`/`)) {
    directory += `/`
  }

  const getFilePath = (url, protocol, directory) => {
    let filePath = url.replace(protocol, ``)
    if (!filePath.includes(`.`)) {
      filePath += `.js`
    }
    filePath = normalizePath(join(directory, filePath))
    return filePath
  }

  const getMultipleFilesPaths = (urls, protocol, directory) =>
    urls
      .replace(protocol, ``)
      .split(`,`)
      .map(url => {
        if (!url.includes(`.`)) {
          url += `.js`
        }

        return {
          url, // filename itself
          filePath: normalizePath(join(directory, url)), // absolute path
        }
      })

  const verifyFile = (path, protocol) => {
    if (
      (protocol !== PROTOCOL_CODE_SANDBOX ||
        protocol !== PROTOCOL_STACKBLITZ) &&
      path.split(`,`).length > 1
    ) {
      throw Error(
        `Code example path should only contain a single file, but found more than one: ${path.replace(
          directory,
          ``
        )}. ` +
          `Only CodeSandbox and StackBlitz REPLs supports multiple files entries, the protocol prefixes of which starts with ${PROTOCOL_CODE_SANDBOX} and ${PROTOCOL_STACKBLITZ}, respectively`
      )
    }
    if (!fs.existsSync(path)) {
      throw Error(`Invalid REPL link specified; no such file "${path}"`)
    }
  }

  const verifyMultipleFiles = (paths, protocol) =>
    paths.forEach(path => verifyFile(path.filePath, protocol))

  map(markdownAST, (node, index, parent) => {
    if (node.type === `link`) {
      if (node.url.startsWith(PROTOCOL_BABEL)) {
        const filePath = getFilePath(node.url, PROTOCOL_BABEL, directory)

        verifyFile(filePath, PROTOCOL_BABEL)

        const code = compress(fs.readFileSync(filePath, `utf8`))
        const href = `https://babeljs.io/repl/#?presets=react&code_lz=${code}`
        const text =
          node.children.length === 0 ? defaultText : node.children[0].value

        convertNodeToLink(node, text, href, target)
      } else if (node.url.startsWith(PROTOCOL_CODEPEN)) {
        const filePath = getFilePath(node.url, PROTOCOL_CODEPEN, directory)

        verifyFile(filePath, PROTOCOL_CODEPEN)

        const href = node.url.replace(PROTOCOL_CODEPEN, `/redirect-to-codepen/`)
        const text =
          node.children.length === 0 ? defaultText : node.children[0].value

        convertNodeToLink(node, text, href, target)
      } else if (node.url.startsWith(PROTOCOL_CODE_SANDBOX)) {
        const filesPaths = getMultipleFilesPaths(
          node.url,
          PROTOCOL_CODE_SANDBOX,
          directory
        )
        verifyMultipleFiles(filesPaths, PROTOCOL_CODE_SANDBOX)

        // CodeSandbox GET API requires a list of "files" keyed by name
        let parameters = {
          files: {
            "package.json": {
              content: {
                dependencies: codesandbox.dependencies.reduce(
                  (map, dependency) => {
                    const { name, fetchSpec } = npa(dependency)
                    map[name] = fetchSpec
                    return map
                  },
                  {}
                ),

                main: filesPaths[0].url,
              },
            },
            "index.html": {
              content: codesandbox.html,
            },
          },
        }

        filesPaths.forEach((path, i) => {
          const code = fs.readFileSync(path.filePath, `utf8`)
          parameters.files[path.url] = {
            content: code,
          }
        })

        // This config JSON must then be lz-string compressed
        parameters = compress(JSON.stringify(parameters))

        const href = `https://codesandbox.io/api/v1/sandboxes/define?parameters=${parameters}`
        const text =
          node.children.length === 0 ? defaultText : node.children[0].value

        convertNodeToLink(node, text, href, target)
      } else if (node.url.startsWith(PROTOCOL_RAMDA)) {
        const filePath = getFilePath(node.url, PROTOCOL_RAMDA, directory)

        verifyFile(filePath, PROTOCOL_RAMDA)

        // Don't use `compress()` as the Ramda REPL won't understand the output.
        // It uses URI to encode the code for its urls, so we do the same.
        const code = URI.encode(fs.readFileSync(filePath, `utf8`))
        const href = `http://ramdajs.com/repl/#?${code}`
        const text =
          node.children.length === 0 ? defaultText : node.children[0].value
        convertNodeToLink(node, text, href, target)
      } else if (node.url.startsWith(PROTOCOL_STACKBLITZ)) {
        const filesPaths = getMultipleFilesPaths(
          node.url,
          PROTOCOL_STACKBLITZ,
          directory
        )
        verifyMultipleFiles(filesPaths, PROTOCOL_STACKBLITZ)

        let parameters = {
          files: {},
          dependencies: JSON.stringify(codesandbox.dependencies),
          template: codesandbox.template,
        }

        filesPaths.forEach(path => {
          const code = fs.readFileSync(path.filePath, `utf8`)
          // Escape " so that it can safely fit in attributes
          parameters.files[path.url] = code.replace(/"/g, `&#34;`)
        })

        const href = `https://stackblitz.com/run`
        const text =
          node.children.length === 0 ? defaultText : node.children[0].value

        function convertNodeToForm(node, text, href, target) {
          const formId = uuidv4()
          target = target
            ? `target="${target}" rel="noreferrer"`
            : `target="_self"`

          delete node.children
          delete node.position
          delete node.title
          delete node.url

          const filesInputs = Object.entries(parameters.files)
            .map(
              ([filename, code]) => `
             <input type="hidden" name="project[files][${filename}]" value="${code}">
          `
            )
            .join(`\n`)

          node.type = `html`
          node.value = `
          <form id="sb_hidden_form${formId}" method="post" action="${href}" ${target}>
            ${filesInputs}
            <input type="hidden" name="project[dependencies]" value="${parameters.dependencies}">
            <input type="hidden" name="project[template]" value="${parameters.template}">
          </form>
          <a href="${href}" onclick="event.preventDefault();document.getElementById('sb_hidden_form${formId}').submit()">${text}</a>
          `
        }

        convertNodeToForm(node, text, href, target)
      }
    }

    // No change
    return node
  })

  return markdownAST
}

const fs = require('fs').promises
const path = require('path')
const execa = require('execa')
const tap = require('tap-parser')
const ejs = require('ejs')

const IGNORE = [
  'findAncestors.ts',
  'findGeo.ts',
  'findText.ts',
  'adminDeletes.ts',
]
const RUNTIME_PATH = path.resolve(__dirname, '..', 'client')

async function generateHTML(output) {
  const markup = ejs.render(
    `
<html>
  <head>
  </head>

  <body>
    <div id="test-list">
      <% for (const test of output) { %>
        <div class="test-entry <%= test.tap.final.ok ? 'pass' : 'fail' %>">
          <h2><span class="test-entry-status"><%- test.tap.final.fail === 0 ? icons.success : icons.fail %></span> <a href="#"><%= test.name %></a></h2>
          <div class="test-entry-details hidden">
            <div class="test-summary">
              <ul>
                <li>Total assertions: <%= test.tap.final.count %></li>
                <li>Passed assertions: <%= test.tap.final.pass %></li>
                <li>Failed assertions: <%= test.tap.final.fail %></li>
                <li>Skipped assertions: <%= test.tap.final.skip %></li>
              </ul>
            </div>
            <div class="test-stdout">
              <pre><%= test.stderr %></pre>
            </div>
          </div>
        </div>
      <% } %>
    </div>

    <script>
      const testNameLinks = document.querySelectorAll('.test-entry h2 a')
      for (let i = 0; i < testNameLinks.length; i++) {
        const link = testNameLinks[i]
        link.addEventListener('click', (e) => {
          e.preventDefault()
          const testEntry = link.parentNode.parentNode
          const details = Array.from(testEntry.childNodes).find(e => e.className && e.className.includes('test-entry-details'))
          if (!details) {
            return
          }

          if (details.className.endsWith('hidden')) {
            details.className = 'test-entry-details'
          } else {
            details.className = 'test-entry-details hidden'
          }
        })
      }
    </script>

    <style>
      body {
        background-color: #b8ccc9;
      }

      .hidden  {
        display: none;
      }

      #test-list {
        margin-left: 20%;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
      }

      .test-entry {
        width: 80%;
        padding: 10px;
        margin-bottom: 20px;

        border-radius: 10px;
        border-color: black;
      }

      .test-entry-details li {
        list-style-type: none;
      }

      .test-entry.pass {
        background-color: #9acd32;
      }

      .test-entry.fail {
        background-color: #f54248;
      }
    </style>
  </body>
</html>
  `,
    {
      output,
      icons: {
        success: '&#10004;&#65039;',
        fail: '&#10060;',
      },
    }
  )

  await fs.writeFile(path.join(process.cwd(), 'output.html'), markup, 'utf8')
}

async function runTest(test) {
  const p = execa('yarn', ['test', `test/${test}`, '--tap'], {
    cwd: RUNTIME_PATH,
  })
  p.stdout.pipe(process.stdout)
  p.stderr.pipe(process.stderr)

  const { stdout, stderr } = await p

  return { stdout, stderr }
}

async function run() {
  const allFiles = await fs.readdir(path.join(RUNTIME_PATH, 'test'))

  const tests = allFiles
    .filter((f) => f.endsWith('.ts') && !IGNORE.includes(f))
    .slice(0, 2) // TODO: remove

  const output = []
  for (const test of tests) {
    let entry = { name: test }
    for (let i = 0; i < 3; i++) {
      try {
        const { stdout, stderr } = await runTest(test)
        entry.stdout = stdout
        entry.stderr = stderr
        entry.retries = i
        break
      } catch (e) {
        const { stderr, stdout } = e
        console.error('HMM ERROR RUNNING TEST (trying again)', e)
        entry.stderr = stderr
        entry.stdout = stdout
        entry.error = e.toString()
      }
    }

    try {
      const tapOutput = tap.parse(entry.stdout)
      entry.tap = {
        raw: tapOutput,
        final: tapOutput.find(([id, _content]) => {
          return id === 'complete'
        })[1],
      }
    } catch (e) {
      console.error('error parsing tap for test', test)
    }

    output.push(entry)
  }

  console.dir(output, { depth: null })

  await generateHTML(output)
}

run().catch((e) => console.error(e))

const deepEqual = require('deep-equal')

const githubPreviewHeaders = [
  `application/vnd.github.mercy-preview+json`, // Topics https://developer.github.com/v3/repos/#replace-all-topics-for-a-repository
  `application/vnd.github.drax-preview+json` // Licenses https://developer.github.com/v3/licenses/
]

// TODO Return to this if relevant
// Set field in package
// Apply note to notes
// function check (field, expected, note) {
  // if (!field) {
  //   field = expected
  //   push note.
  // }
// }

// Set the package description to match the GitHub description
async function checkDescription (github, pkg, ghDescription, notesForUser) {
  if (ghDescription !== pkg.description) {
    if (ghDescription && !pkg.description) {
      pkg.description = ghDescription
      notesForUser.push(`We've added "${ghDescription}" as the description in the \`package.json\`. We got this from the GitHub repo description.`)
    } else if (!ghDescription && pkg.description) {
      const {data} = await github.patch(`/repos/${github.repoName}`, {
        description: pkg.description,
        name: github.repoName
      }).catch(err => {
        if (err) {}
        console.robowarn(`Unable to set GitHub description using \`package.json\` description. Probably a permissions error.`)
        notesForUser.push(`Add a GitHub description. Your \`package.json\` description should work.`)
      })
      if (data.description === pkg.description) {
        console.robolog(`I set the GitHub description to match the \`package.json\` description.`)
      }
    } else {
      notesForUser.push(`Check the \`package.json\` description. It didn't match the GitHub description for the repository.`)
    }
  }
}

function checkRepository (github, pkg, notesForUser) {
  // TODO Enable this, too: JSON.parse({'type': 'git', 'url': `https://github.com/${github.repoName}.git`}).toString()
  const expectedRepo = {
    'type': 'git',
    // TODO Allow "url": "git://github.com/simonv3/covenant-generator.git"
    'url': `https://github.com/${github.repoName}.git`
  }
  if (!pkg.repository) {
    pkg.repository = expectedRepo // username/repo is also valid https://docs.npmjs.com/files/package.json#repository
  } else if (!deepEqual(pkg.repository, expectedRepo)) {
    notesForUser.push(`We expected the repository url in the \`package.json\` to be ${expectedRepo.url.split('.git')[0]}, and it wasn't. Is this intentional?`)
  }
}

// Check that the homepage is valid
function checkHomepage (github, pkg, notesForUser) {
  // TODO Use the GitHub homepage if it exists
  if (!pkg.homepage) {
    pkg.homepage = `https://github.com/${github.repoName}`
    notesForUser.push(`Check that the homepage in the \`package.json\` is OK. Another one besides your GitHub repo might work. We've set it to https://github.com/${github.repoName}.`)
  }
}

function arrToQuotedArr (arr) {
  return arr.map(k => `"${k}"`).join(', ')
}

async function checkKeywords (github, pkg, topics, notesForUser) {
  // Note: This uses a GitHub preview header, and may break.
  // Uniquify and filter out null and undefined
  const allKeywords = [ ...new Set(topics.concat(pkg.keywords)) ].filter(x => x)
  if (!deepEqual(allKeywords, pkg.keywords)) {
    pkg.keywords = allKeywords // Add this even if allKeywords is empty, because the field is worth having
    if (allKeywords.length === 0) {
      notesForUser.push(`Add some keywords to your package.json. We've added an empty \`keywords\` field for now.`)
    } else {
      notesForUser.push(`Check the \`package.json\` keywords. We added these from your GitHub topics: ${arrToQuotedArr(pkg.keywords)}.`)
    }
  }
  if (allKeywords.length !== 0 && !deepEqual(allKeywords, topics)) {
    const {data} = await github.put(`/repos/${github.repoName}/topics`, {
      names: allKeywords
    }).catch(err => {
      console.robowarn('Unable to set GitHub topics using `package.json` keywords. Probably a permissions error.')
      notesForUser.push(`Add these keywords (from your \`package.json\`) as GitHub topics to your repo: ${arrToQuotedArr(allKeywords)}.`)
      if (err) {
        return false
      }
    })
    if (data && data.topics === allKeywords) {
      console.robolog('I set the GitHub topics to include all `package.json` keywords.')
      notesForUser.push(`Check your GitHub topics. I added some from your \`package.json\` keywords.`)
    }
  }
}

module.exports = {
  lint,
  checkHomepage,
  checkRepository,
  checkKeywords,
  checkDescription
}

async function lint (github, pkg) {
  const notesForUser = []

  // Add in the headers we need for these calls
  githubPreviewHeaders.map(header => github.defaults.headers.common.accept.push(header))

  const {data: {description, topics, license}} = await github.get(`/repos/${github.repoName}`)

  // Check the GitHub and npm descriptions
  await checkDescription(github, pkg, description, notesForUser)

  // Check that the keywords match GitHub topics
  await checkKeywords(github, pkg, topics, notesForUser)

  // Check that the homepage exists
  checkHomepage(github, pkg, notesForUser)

  // Check that `bugs` matches GitHub URL
  if (!pkg.bugs) {
    pkg.bugs = {
      'url': `https://github.com/${github.repoName}/issues`
    }
  } else if (pkg.bugs !== `https://github.com/${github.repoName}/issues` || pkg.bugs.url !== `https://github.com/${github.repoName}/issues`) {
    notesForUser.push(`Check that the bugs field in the package.json is OK. It doesn't match what we'd expect, which would be https://github.com/${github.repoName}/issues`)
  }

  if (!pkg.license) {
    pkg.license = 'MIT'
    notesForUser.push(`Check the license in your \`package.json\`. We added "MIT" for now.`)
  } else if (license && pkg.license !== license.spdx_id) {
    // Check that the license matches
    notesForUser.push(`Update the license in your \`package.json\`. It did not match what we found on GitHub, and we were unable to resolve this.`)
  }

  // Check that the repository matches
  checkRepository(github, pkg, notesForUser)

  if (!pkg.contributors) {
    pkg.contributors = [pkg.author]
    notesForUser.push(`If there are more contributors, add them to the Contributors field in the \`package.json\`.`)
  }

  // Tests
  if (!pkg.scripts || !pkg.scripts.test || pkg.scripts.test.indexOf('no test specified') !== -1) {
    notesForUser.push(`Add some tests! There aren't any currently set. [Use this link to stub out an issue.](https://github.com/${github.repoName}/issues/new?title=Add%20Tests&body=Tests%20are%20useful%20for%20ensuring%20code%20quality.%20No%20tests%20were%20found%20in%20the%20package%20manifest.)`)
    // TODO Open an issue suggesting that they add tests
    // const query = querystring.stringify({
    //   type: 'issue',
    //   is: 'open',
    //   repo: github.repoName
    // }, 'tests', ':')

    // const testIssueResult = await github.get(`/search/issues?q=${query}`).catch(err => err)
    // console.log('Here', testIssueResult)

    // const result = await github.post(`/repos/${github.repoName}/issues`, {
    //   title: 'Add tests',
    //   body: `No tests are specified in the npm manifest. Do you have tests for this repo yet?`
    // })
    //
    // const {data: {html_url: issueUrl}} = result
    // console.log(`🤖🙏 issue opened as a reminder to add tests: ${issueUrl}`)
  }

  return {pkg, notesForUser}
}

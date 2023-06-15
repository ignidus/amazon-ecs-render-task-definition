const path = require('path');
const core = require('@actions/core');
const tmp = require('tmp');
const fs = require('fs');

function parseEnvironmentVariables(environmentVariables) {
  const vars = [];

  environmentVariables.split('\n').forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) { return; }
    
    const separatorIdx = trimmedLine.indexOf("=");

    if (separatorIdx === -1) {
        throw new Error(`Cannot parse the environment variable '${trimmedLine}'. Environment variable pairs must be of the form NAME=value.`);
    }

    vars.push({
      name: trimmedLine.substring(0, separatorIdx),
      value: trimmedLine.substring(separatorIdx + 1),
    });
  });

  return vars;
}

async function run() {
  try {
    // Get inputs
    const taskDefinitionFile = core.getInput('task-definition', { required: true });
    const containerName = core.getInput('container-name', { required: true });
    const imageURI = core.getInput('image', { required: true });
    const environmentVariables = core.getInput('environment-variables', { required: false });
    const environmentFiles = core.getInput('environment-files', { required: false });

    // Parse the task definition
    const taskDefPath = path.isAbsolute(taskDefinitionFile) ?
      taskDefinitionFile :
      path.join(process.env.GITHUB_WORKSPACE, taskDefinitionFile);
    if (!fs.existsSync(taskDefPath)) {
      throw new Error(`Task definition file does not exist: ${taskDefinitionFile}`);
    }
    const taskDefContents = require(taskDefPath);

    // Insert the image URI
    if (!Array.isArray(taskDefContents.containerDefinitions)) {
      throw new Error('Invalid task definition format: containerDefinitions section is not present or is not an array');
    }
    const containerDef = taskDefContents.containerDefinitions.find(function(element) {
      return element.name == containerName;
    });
    if (!containerDef) {
      throw new Error('Invalid task definition: Could not find container definition with matching name');
    }
    containerDef.image = imageURI;

    const envVars = [];

    // Apply environment variables from each file specified in order
    if (environmentFiles) {
      environmentFiles.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine.length === 0) { return; }

        if (!fs.existsSync(trimmedLine)) {
          throw new Error(`Environment file not found: ${trimmedLine}`);
        }

        const fileVariables = fs.readFileSync(trimmedLine);

        envVars.push(...parseEnvironmentVariables(fileVariables));
      });
    }

    // Apply environment variables explicitly written, overwriting same variables from files
    if (environmentVariables) {
      envVars.push(...parseEnvironmentVariables(environmentVariables));
    }

    if (envVars) {
      if (!Array.isArray(containerDef.environment)) {
        containerDef.environment = [];
      }
      envVars.forEach(variable => {
        const variableDef = containerDef.environment.find((e) => e.name == variable.name);
        if (variableDef) {
          variableDef.value = variable.value;
        } else {
          containerDef.environment.push(variable);
        }
      })
    }

    // Write out a new task definition file
    var updatedTaskDefFile = tmp.fileSync({
      tmpdir: process.env.RUNNER_TEMP,
      prefix: 'task-definition-',
      postfix: '.json',
      keep: true,
      discardDescriptor: true
    });
    const newTaskDefContents = JSON.stringify(taskDefContents, null, 2);
    fs.writeFileSync(updatedTaskDefFile.name, newTaskDefContents);
    core.setOutput('task-definition', updatedTaskDefFile.name);
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

module.exports = run;

/* istanbul ignore next */
if (require.main === module) {
    run();
}

export function helloWorld(name = 'Lainclaw') {
  return `Hello, ${name}!`;
}

export function runHelloWorld(name = 'Lainclaw') {
  console.log(helloWorld(name));
}

const nameArg = process.argv[2];
if (nameArg === '-h' || nameArg === '--help' || nameArg === 'help') {
  console.log('Usage: lainclaw [name]');
  console.log('  without name => Hello, Lainclaw!');
} else {
  runHelloWorld(nameArg);
}

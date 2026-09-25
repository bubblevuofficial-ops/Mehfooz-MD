module.exports = [
  {
    name: 'setprefix',
    desc: 'Change bot prefix',
    ownerOnly: true,
    execute: async ({ reply, args, db }) => {
      if (!args[0]) return await reply('Please provide a new prefix. Example: .setprefix !');
      db.prefix = args[0];
      await reply(`Success! Bot prefix updated to: ${db.prefix}`);
    }
  },
  {
    name: 'setmode',
    desc: 'Change bot access mode',
    ownerOnly: true,
    execute: async ({ reply, args, db }) => {
      const newMode = args[0]?.toLowerCase();
      if (newMode !== 'public' && newMode !== 'private') {
        return await reply('Invalid mode! Use: .setmode public OR .setmode private');
      }
      db.mode = newMode;
      await reply(`Success! Bot mode changed to: ${db.mode}`);
    }
  }
];
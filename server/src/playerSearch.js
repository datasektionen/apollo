export function collectCreditInvolvements({
  projectId = '',
  projectName = '',
  musicalNumber = '',
  showId = '',
  showName = '',
  credits = null,
  showProducers = [],
} = {}) {
  const involvements = [];
  const seen = new Set();

  const add = (artist, roleKey, roleLabel, extra = {}) => {
    if (!artist?.id || !artist?.name || !roleKey) return;
    const next = {
      artistKey: `${artist.type}:${artist.id}`,
      artistType: artist.type,
      artistId: artist.id,
      name: artist.name,
      description: artist.description || '',
      groupType: artist.groupType || '',
      roleKey,
      roleLabel: roleLabel || roleKey,
      projectId: extra.projectId ?? projectId,
      projectName: extra.projectName ?? projectName,
      musicalNumber: extra.musicalNumber ?? musicalNumber,
      showId: extra.showId ?? showId,
      showName: extra.showName ?? showName,
      contributionLabel: extra.contributionLabel || '',
    };
    const dedupeKey = [
      next.artistKey,
      next.roleKey,
      next.projectId || '',
      next.showId || '',
      next.contributionLabel,
    ].join('|');
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    involvements.push(next);
  };

  ['artist', 'compositionLyrics', 'productionEngineering'].forEach((category) => {
    (credits?.[category] || []).forEach((entry) => {
      (entry.artists || []).forEach((artist) => add(artist, entry.roleKey, entry.roleLabel));
    });
  });

  const walkPerformers = (rows = []) => {
    rows.forEach((row) => {
      const artist = row.artist || row.artists?.[0];
      add(artist, 'performer', 'Performer', {
        contributionLabel: row.contributionLabel || row.contributionName || row.partName || '',
      });
      if (row.members?.length) walkPerformers(row.members);
    });
  };
  walkPerformers(credits?.performers || []);

  (showProducers || []).forEach((artist) => {
    add(artist, 'show_producer', 'Show producer', {
      projectId: '',
      projectName: '',
      musicalNumber: '',
    });
  });

  return involvements;
}

export function groupInvolvementsByArtist(involvements = []) {
  const byArtist = new Map();
  involvements.forEach((row) => {
    if (!row?.artistKey) return;
    if (!byArtist.has(row.artistKey)) {
      byArtist.set(row.artistKey, {
        artistKey: row.artistKey,
        artistType: row.artistType,
        artistId: row.artistId,
        name: row.name,
        description: row.description || '',
        groupType: row.groupType || '',
        involvements: [],
      });
    }
    byArtist.get(row.artistKey).involvements.push({
      roleKey: row.roleKey,
      roleLabel: row.roleLabel,
      projectId: row.projectId || '',
      projectName: row.projectName || '',
      musicalNumber: row.musicalNumber || '',
      showId: row.showId || '',
      showName: row.showName || '',
      contributionLabel: row.contributionLabel || '',
    });
  });
  return Array.from(byArtist.values());
}

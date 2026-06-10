async function loadEditionSponsors(supabase, editionId, options = {}) {
  let query = supabase
    .from('sponsor_requests')
    .select('id,company,slot_type,preview_status,payment_status,materials_status,sponsor_assets(logo_url,headline,body,cta_url)')
    .eq('edition_id', editionId)
    .eq('payment_status', 'received')
    .eq('materials_status', 'approved');

  if (!options.includeUnapproved) query = query.eq('preview_status', 'approved');
  const { data, error } = await query;
  if (error) throw error;

  return Promise.all((data || []).map(async (request) => {
    const asset = Array.isArray(request.sponsor_assets)
      ? request.sponsor_assets[0]
      : request.sponsor_assets;
    if (!asset) return { ...request, asset: null };
    let logoSignedUrl = null;
    if (asset.logo_url) {
      const { data: signed } = await supabase.storage
        .from('sponsor-assets')
        .createSignedUrl(asset.logo_url, 60 * 60 * 24 * 30);
      logoSignedUrl = signed && signed.signedUrl;
    }
    return {
      ...request,
      asset: {
        ...asset,
        logo_signed_url: logoSignedUrl
      }
    };
  }));
}

module.exports = {
  loadEditionSponsors
};

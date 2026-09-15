import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
    const newSources = [
        // Embassies
        { name: 'U.S. Embassy Kenya', base_url: 'https://ke.usembassy.gov/embassy/jobs/', type: 'html', category: 'Embassy', active: true, parsing_config: { priority_level: 4, site_url: 'https://ke.usembassy.gov' } },
        { name: 'British High Commission Kenya', base_url: 'https://fco.tal.net/vx/appcentre-ext/candidate/search/results', type: 'html', category: 'Embassy', active: true, parsing_config: { priority_level: 4, site_url: 'https://fco.tal.net' } },
        { name: 'German Embassy Nairobi', base_url: 'https://nairobi.diplo.de/ke-en/service/stellenangebote', type: 'html', category: 'Embassy', active: true, parsing_config: { priority_level: 4, site_url: 'https://nairobi.diplo.de' } },
        { name: 'High Commission of Canada in Kenya', base_url: 'https://www.international.gc.ca/world-monde/staff_recruitment-recrutement_personnel/index.aspx?lang=eng', type: 'html', category: 'Embassy', active: true, parsing_config: { priority_level: 4, site_url: 'https://www.international.gc.ca' } },
        { name: 'Netherlands Embassy in Kenya', base_url: 'https://www.netherlandsandyou.nl/your-country-and-the-netherlands/kenya/about-us/vacancies', type: 'html', category: 'Embassy', active: true, parsing_config: { priority_level: 4, site_url: 'https://www.netherlandsandyou.nl' } },
        // UN Agencies
        { name: 'UNICEF', base_url: 'https://jobs.unicef.org', type: 'html', category: 'NGO', active: true, parsing_config: { priority_level: 4, site_url: 'https://jobs.unicef.org' } },
        { name: 'UNOPS', base_url: 'https://jobs.unops.org', type: 'html', category: 'NGO', active: true, parsing_config: { priority_level: 4, site_url: 'https://jobs.unops.org' } },
        { name: 'UN Women', base_url: 'https://jobs.unwomen.org', type: 'html', category: 'NGO', active: true, parsing_config: { priority_level: 4, site_url: 'https://jobs.unwomen.org' } },
        { name: 'World Food Programme', base_url: 'https://www.wfp.org/careers/job-openings', type: 'html', category: 'NGO', active: true, parsing_config: { priority_level: 4, site_url: 'https://www.wfp.org' } },
        { name: 'UNHCR', base_url: 'https://careers.unhcr.org', type: 'html', category: 'NGO', active: true, parsing_config: { priority_level: 4, site_url: 'https://careers.unhcr.org' } },
        // Development Banks
        { name: 'International Finance Corporation', base_url: 'https://ifc.csod.com/ux/ats/careersite/2/home', type: 'html', category: 'Bank', active: true, parsing_config: { priority_level: 4, site_url: 'https://ifc.csod.com' } },
        { name: 'European Investment Bank', base_url: 'https://www.eib.org/en/about/jobs', type: 'html', category: 'Bank', active: true, parsing_config: { priority_level: 4, site_url: 'https://www.eib.org' } },
        // Foundations
        { name: 'Bill & Melinda Gates Foundation', base_url: 'https://www.gatesfoundation.org/about/careers', type: 'html', category: 'Foundation', active: true, parsing_config: { priority_level: 4, site_url: 'https://www.gatesfoundation.org' } },
        { name: 'Mastercard Foundation', base_url: 'https://mastercardfdn.org/careers/', type: 'html', category: 'Foundation', active: true, parsing_config: { priority_level: 4, site_url: 'https://mastercardfdn.org' } },
        { name: 'Rockefeller Foundation', base_url: 'https://www.rockefellerfoundation.org/careers/', type: 'html', category: 'Foundation', active: true, parsing_config: { priority_level: 4, site_url: 'https://www.rockefellerfoundation.org' } },
        { name: 'Ford Foundation', base_url: 'https://www.fordfoundation.org/work-with-us/', type: 'html', category: 'Foundation', active: true, parsing_config: { priority_level: 4, site_url: 'https://www.fordfoundation.org' } }
    ];

    const { data, error } = await supabase.from('job_sources').insert(newSources).select();

    if (error) {
        return NextResponse.json({ success: false, error });
    }

    // Also update existing UNDP, World Bank, AfDB to Tier 4
    await supabase.from('job_sources').update({ parsing_config: { priority_level: 4 } }).in('name', ['UNDP Careers', 'World Bank Careers', 'African Development Bank']);

    return NextResponse.json({ success: true, inserted: data });
}

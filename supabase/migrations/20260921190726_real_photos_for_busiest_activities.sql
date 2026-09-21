/*
 * Deset aktivit s nejvíc živými FLEKy dostává skutečné fotografie místo generovaných.
 * Adresy míří na CDN Unsplashe, který už je povolený v CSP i v `private.is_allowed_picture`;
 * velikost si vyžádá `thumbnail()` parametrem `w`.
 *
 * Mění se jen řádky, kde hodnota přesně odpovídá staré ilustraci, takže fotografie nahraná
 * podnikem do Storage zůstane nedotčená. Zbylých 26 aktivit zůstává na lokální sadě.
 */
with nove(slug, varianta, adresa) as (values
  ('vlasy-pansky-strih', 1, 'https://images.unsplash.com/photo-1600948836101-f9ffda59d250?w=800&q=70&auto=format&fit=crop'),
  ('vlasy-pansky-strih', 2, 'https://images.unsplash.com/photo-1637777277337-f114350fb088?w=800&q=70&auto=format&fit=crop'),
  ('vlasy-uprava-vousu', 1, 'https://images.unsplash.com/photo-1595285203581-6f01855f6e7a?w=800&q=70&auto=format&fit=crop'),
  ('vlasy-uprava-vousu', 2, 'https://images.unsplash.com/photo-1564556902913-581221ed8d3d?w=800&q=70&auto=format&fit=crop'),
  ('masaze-zada-sije', 1, 'https://images.unsplash.com/photo-1700142360825-d21edc53c8db?w=800&q=70&auto=format&fit=crop'),
  ('masaze-zada-sije', 2, 'https://images.unsplash.com/photo-1731597076108-f3bbe268162f?w=800&q=70&auto=format&fit=crop'),
  ('krasa-manikura', 1, 'https://images.unsplash.com/photo-1602585578130-c9076e09330d?w=800&q=70&auto=format&fit=crop'),
  ('krasa-manikura', 2, 'https://images.unsplash.com/photo-1599948128020-9a44505b0d1b?w=800&q=70&auto=format&fit=crop'),
  ('wellness-odpocinek', 1, 'https://images.unsplash.com/photo-1693578538512-fc66f318c833?w=800&q=70&auto=format&fit=crop'),
  ('wellness-odpocinek', 2, 'https://images.unsplash.com/photo-1761470575018-135c213340eb?w=800&q=70&auto=format&fit=crop'),
  ('sport-pujceni-kola', 1, 'https://images.unsplash.com/photo-1745947454393-74bc35250ffa?w=800&q=70&auto=format&fit=crop'),
  ('sport-pujceni-kola', 2, 'https://images.unsplash.com/photo-1670753171916-1063917beacb?w=800&q=70&auto=format&fit=crop'),
  ('sport-osobni-trenink', 1, 'https://images.unsplash.com/photo-1712220403561-bcf3f59d5927?w=800&q=70&auto=format&fit=crop'),
  ('sport-osobni-trenink', 2, 'https://images.unsplash.com/photo-1724763750864-9e81ee45d036?w=800&q=70&auto=format&fit=crop'),
  ('sport-padel', 1, 'https://images.unsplash.com/photo-1658723826297-fe4d1b1e6600?w=800&q=70&auto=format&fit=crop'),
  ('sport-padel', 2, 'https://images.unsplash.com/photo-1657704358775-ed705c7388d2?w=800&q=70&auto=format&fit=crop'),
  ('joga-rani-protazeni', 1, 'https://images.unsplash.com/photo-1646239646963-b0b9be56d6b5?w=800&q=70&auto=format&fit=crop'),
  ('joga-rani-protazeni', 2, 'https://images.unsplash.com/photo-1676496962536-d8ef110ff6f0?w=800&q=70&auto=format&fit=crop'),
  ('sport-tenis', 1, 'https://images.unsplash.com/photo-1685880423505-3a9a5515efd9?w=800&q=70&auto=format&fit=crop'),
  ('sport-tenis', 2, 'https://images.unsplash.com/photo-1774532665451-eff4bcd879e0?w=800&q=70&auto=format&fit=crop')
),
katalog as (
  update public.service_photos p set image_url = n.adresa
  from nove n
  where p.slug = n.slug and n.varianta = 1
  returning 1
),
sluzby as (
  update public.services s set image_url = n.adresa
  from nove n
  where s.image_url = '/images/activities/' || n.slug || '-' || n.varianta || '.jpg'
  returning 1
)
update public.businesses b set cover_url = n.adresa, updated_at = now()
from nove n
where b.cover_url = '/images/activities/' || n.slug || '-' || n.varianta || '.jpg';
